use keyring::Entry;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const DNAC_KEYRING_SERVICE: &str = "app.netssh.client.dnac";
const DNAC_KEYRING_ACCOUNT: &str = "connection";
const AUTH_PATH: &str = "/dna/system/api/v1/auth/token";
const CLIENT_DETAIL_PATH: &str = "/dna/intent/api/v1/client-detail";
const TOKEN_LIFETIME: Duration = Duration::from_secs(55 * 60);

#[derive(Default)]
pub struct DnacState {
    token: Mutex<Option<CachedToken>>,
}

struct CachedToken {
    server_url: String,
    username: String,
    allow_invalid_certificates: bool,
    value: String,
    expires_at: Instant,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnacConnectionRequest {
    server_url: String,
    username: String,
    password: Option<String>,
    allow_invalid_certificates: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnacConnectionResult {
    connected: bool,
    server: String,
    certificate_verification: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnacClientResult {
    hostname: Option<String>,
    user_id: Option<String>,
    ip_address: Option<String>,
    ipv6_addresses: Vec<String>,
    mac_address: String,
    connection_status: Option<String>,
    connection_type: Option<String>,
    health_score: Option<i64>,
    health_reason: Option<String>,
    location: Option<String>,
    site: Option<String>,
    building: Option<String>,
    floor: Option<String>,
    connected_device: Option<String>,
    connected_device_ip: Option<String>,
    interface_name: Option<String>,
    vlan_id: Option<String>,
    ssid: Option<String>,
    frequency: Option<String>,
    channel: Option<String>,
    operating_system: Option<String>,
    device_type: Option<String>,
    vendor: Option<String>,
    last_updated: Option<i64>,
}

fn password_entry() -> Result<Entry, String> {
    Entry::new(DNAC_KEYRING_SERVICE, DNAC_KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn has_dnac_password() -> bool {
    password_entry()
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok_and(|password| !password.is_empty())
}

#[tauri::command]
pub fn save_dnac_password(password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("DNAC password cannot be empty".into());
    }
    super::store_vault_secret(password_entry()?, &password, "DNAC password")
}

#[tauri::command]
pub fn delete_dnac_password() -> Result<(), String> {
    match password_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Unable to remove the DNAC password from the operating-system vault: {error}"
        )),
    }
}

#[tauri::command]
pub async fn clear_dnac_connection(state: tauri::State<'_, DnacState>) -> Result<(), String> {
    *state.token.lock().await = None;
    delete_dnac_password()
}

fn normalized_settings(request: &DnacConnectionRequest) -> Result<(String, String), String> {
    let username = request.username.trim().to_owned();
    if username.is_empty() {
        return Err("Enter your Cisco Catalyst Center username".into());
    }
    let input = request.server_url.trim().trim_end_matches('/');
    if input.is_empty() {
        return Err("Enter the Cisco Catalyst Center server URL".into());
    }
    let parsed = Url::parse(input).map_err(|_| {
        "Enter a valid Catalyst Center URL, for example https://dnac.example.net".to_string()
    })?;
    if parsed.scheme() != "https" {
        return Err("Catalyst Center connections must use HTTPS".into());
    }
    if parsed.host_str().is_none() || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(
            "Enter only the Catalyst Center server URL, without a query or fragment".into(),
        );
    }
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err("Enter only the Catalyst Center server URL, without an API path".into());
    }
    Ok((input.to_owned(), username))
}

fn client(request: &DnacConnectionRequest) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(25))
        .danger_accept_invalid_certs(request.allow_invalid_certificates)
        .user_agent("NetSSH/0.1 Catalyst-Center")
        .build()
        .map_err(|error| format!("Unable to prepare the DNAC connection: {error}"))
}

fn resolve_password(supplied: Option<&str>) -> Result<String, String> {
    if let Some(password) = supplied.filter(|value| !value.is_empty()) {
        return Ok(password.to_owned());
    }
    match password_entry()?.get_password() {
        Ok(password) if !password.is_empty() => Ok(password),
        Ok(_) | Err(keyring::Error::NoEntry) => Err(
            "No DNAC password is saved. Open Settings, enter your password, and test the connection."
                .into(),
        ),
        Err(error) => Err(format!(
            "The operating-system vault could not read the DNAC password: {error}"
        )),
    }
}

fn request_error(error: reqwest::Error) -> String {
    let detail = error.to_string();
    let lower = detail.to_ascii_lowercase();
    if error.is_timeout() {
        "Catalyst Center did not respond before the connection timed out".into()
    } else if lower.contains("certificate") || lower.contains("unknown issuer") {
        "Catalyst Center's TLS certificate could not be verified. Ask your IT team to fix or trust the certificate; use the self-signed certificate option only if they confirm it is safe.".into()
    } else if error.is_connect() {
        format!("Could not connect to Catalyst Center: {detail}")
    } else {
        format!("Catalyst Center request failed: {detail}")
    }
}

fn response_message(body: &Value) -> Option<&str> {
    body.pointer("/response/message")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/response/detail").and_then(Value::as_str))
        .or_else(|| body.pointer("/error/message").and_then(Value::as_str))
        .or_else(|| body.get("message").and_then(Value::as_str))
}

fn status_error(status: StatusCode, body: &Value, context: &str) -> String {
    let message = response_message(body).unwrap_or(context);
    match status {
        StatusCode::UNAUTHORIZED => {
            "Catalyst Center rejected the username or password. Check the credentials and try again."
                .into()
        }
        StatusCode::FORBIDDEN => {
            "The DNAC account is authenticated but does not have permission to use this API.".into()
        }
        StatusCode::NOT_FOUND => format!("{context} was not found on this Catalyst Center."),
        _ => format!("Catalyst Center returned HTTP {}: {message}", status.as_u16()),
    }
}

async fn authenticate(
    request: &DnacConnectionRequest,
    state: &DnacState,
    force: bool,
) -> Result<(Client, String, String), String> {
    let (server_url, username) = normalized_settings(request)?;
    let http = client(request)?;
    if !force {
        let cached = state.token.lock().await;
        if let Some(token) = cached.as_ref().filter(|token| {
            token.server_url == server_url
                && token.username == username
                && token.allow_invalid_certificates == request.allow_invalid_certificates
                && token.expires_at > Instant::now()
        }) {
            return Ok((http, server_url, token.value.clone()));
        }
    }

    let password = resolve_password(request.password.as_deref())?;
    let response = http
        .post(format!("{server_url}{AUTH_PATH}"))
        .basic_auth(&username, Some(&password))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        format!("Unable to read the Catalyst Center authentication response: {error}")
    })?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(
        |_| serde_json::json!({ "message": text.chars().take(300).collect::<String>() }),
    );
    if !status.is_success() {
        return Err(status_error(status, &body, "Authentication"));
    }
    let token = body
        .get("Token")
        .or_else(|| body.get("token"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Catalyst Center authenticated but did not return an API token".to_string())?
        .to_owned();
    *state.token.lock().await = Some(CachedToken {
        server_url: server_url.clone(),
        username,
        allow_invalid_certificates: request.allow_invalid_certificates,
        value: token.clone(),
        expires_at: Instant::now() + TOKEN_LIFETIME,
    });
    Ok((http, server_url, token))
}

#[tauri::command]
pub async fn test_dnac_connection(
    request: DnacConnectionRequest,
    state: tauri::State<'_, DnacState>,
) -> Result<DnacConnectionResult, String> {
    let (_, server, _) = authenticate(&request, &state, true).await?;
    Ok(DnacConnectionResult {
        connected: true,
        server,
        certificate_verification: !request.allow_invalid_certificates,
    })
}

async fn client_detail_request(
    http: &Client,
    server_url: &str,
    token: &str,
    mac_address: &str,
) -> Result<(StatusCode, Value), String> {
    let response = http
        .get(format!("{server_url}{CLIENT_DETAIL_PATH}"))
        .header("X-Auth-Token", token)
        .header("Accept", "application/json")
        .query(&[("macAddress", mac_address)])
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read the Catalyst Center client response: {error}"))?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(
        |_| serde_json::json!({ "message": text.chars().take(300).collect::<String>() }),
    );
    Ok((status, body))
}

#[tauri::command]
pub async fn search_dnac_client(
    request: DnacConnectionRequest,
    mac_address: String,
    state: tauri::State<'_, DnacState>,
) -> Result<DnacClientResult, String> {
    let mac = normalize_mac(&mac_address)?;
    let (mut http, mut server, mut token) = authenticate(&request, &state, false).await?;
    let (mut status, mut body) = client_detail_request(&http, &server, &token, &mac).await?;
    if status == StatusCode::UNAUTHORIZED {
        *state.token.lock().await = None;
        (http, server, token) = authenticate(&request, &state, true).await?;
        (status, body) = client_detail_request(&http, &server, &token, &mac).await?;
    }
    if !status.is_success() {
        return Err(status_error(status, &body, "Client"));
    }
    parse_client_detail(&body, &mac)
}

fn normalize_mac(value: &str) -> Result<String, String> {
    let compact: String = value
        .chars()
        .filter(|character| !matches!(character, ':' | '-' | '.'))
        .collect();
    if compact.len() != 12
        || !compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Enter a valid 12-digit MAC address, for example AA:BB:CC:DD:EE:FF".into());
    }
    let upper = compact.to_ascii_uppercase();
    Ok((0..6)
        .map(|index| &upper[index * 2..index * 2 + 2])
        .collect::<Vec<_>>()
        .join(":"))
}

fn value_string(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key))
        .and_then(|value| match value {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_owned()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
}

fn find_interface(topology: Option<&Value>, mac: &str) -> Option<String> {
    let links = topology?.get("links")?.as_array()?;
    for link in links {
        let link_object = link.as_object()?;
        if let Some(details) = link_object
            .get("interfaceDetails")
            .and_then(Value::as_array)
        {
            for detail in details {
                let object = detail.as_object()?;
                let detail_mac = value_string(object, &["clientMacAddress"]).unwrap_or_default();
                if normalize_mac(&detail_mac).ok().as_deref() == Some(mac) {
                    if let Some(interface) = value_string(
                        object,
                        &["connectedDeviceIntName", "interfaceName", "interface"],
                    ) {
                        return Some(interface);
                    }
                }
            }
        }
    }
    None
}

fn location_parts(location: Option<&str>) -> (Option<String>, Option<String>, Option<String>) {
    let parts: Vec<String> = location
        .unwrap_or_default()
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty() && !part.eq_ignore_ascii_case("global"))
        .map(str::to_owned)
        .collect();
    if parts.is_empty() {
        return (None, None, None);
    }
    let floor_index = parts
        .iter()
        .rposition(|part| part.to_ascii_lowercase().contains("floor"));
    let floor = floor_index.and_then(|index| parts.get(index).cloned());
    let building = floor_index
        .and_then(|index| index.checked_sub(1))
        .and_then(|index| parts.get(index).cloned());
    let site = if let Some(index) = floor_index.and_then(|index| index.checked_sub(2)) {
        parts.get(index).cloned()
    } else {
        parts.last().cloned()
    };
    (site, building, floor)
}

fn parse_client_detail(body: &Value, requested_mac: &str) -> Result<DnacClientResult, String> {
    let detail = body
        .get("detail")
        .and_then(Value::as_object)
        .ok_or_else(|| "No client was found for that MAC address in Catalyst Center".to_string())?;
    let health = detail
        .get("healthScore")
        .and_then(Value::as_array)
        .and_then(|scores| {
            scores
                .iter()
                .filter_map(Value::as_object)
                .max_by_key(|score| {
                    let health_type = value_string(score, &["healthType"])
                        .unwrap_or_default()
                        .to_ascii_lowercase();
                    i32::from(health_type.contains("client")) * 2
                        + i32::from(health_type.contains("overall"))
                })
        });
    let health_score = health
        .and_then(|score| score.get("score"))
        .and_then(Value::as_i64);
    let health_reason = health.and_then(|score| value_string(score, &["reason"]));
    let location = value_string(detail, &["location", "siteHierarchy", "site"]);
    let (site, building, floor) = location_parts(location.as_deref());

    let connected = detail
        .get("connectedDevice")
        .and_then(Value::as_array)
        .and_then(|devices| {
            devices
                .iter()
                .filter_map(Value::as_object)
                .find(|device| {
                    let kind = value_string(device, &["type"]).unwrap_or_default();
                    kind.eq_ignore_ascii_case("switch") || kind.eq_ignore_ascii_case("ap")
                })
                .or_else(|| devices.iter().find_map(Value::as_object))
        });
    let connected_device = connected
        .and_then(|device| value_string(device, &["name", "hostname", "deviceName"]))
        .or_else(|| value_string(detail, &["clientConnection", "connectedDeviceName"]));
    let connected_device_ip = connected.and_then(|device| {
        value_string(
            device,
            &["ip address", "ipAddress", "managementIpAddress", "ip"],
        )
    });
    let interface_name = connected
        .and_then(|device| {
            value_string(
                device,
                &[
                    "interfaceName",
                    "connectedDeviceIntName",
                    "interface",
                    "port",
                ],
            )
        })
        .or_else(|| find_interface(body.get("topology"), requested_mac));
    let ipv6_addresses = detail
        .get("hostIpV6")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();

    Ok(DnacClientResult {
        hostname: value_string(detail, &["hostName", "hostname", "identifier"]),
        user_id: value_string(detail, &["userId", "upnName", "upnId"]),
        ip_address: value_string(detail, &["hostIpV4", "ipAddress"]),
        ipv6_addresses,
        mac_address: value_string(detail, &["hostMac", "macAddress"])
            .unwrap_or_else(|| requested_mac.to_owned()),
        connection_status: value_string(detail, &["connectionStatus", "status"]),
        connection_type: value_string(detail, &["hostType", "connectionType"]),
        health_score,
        health_reason,
        location,
        site,
        building,
        floor,
        connected_device,
        connected_device_ip,
        interface_name,
        vlan_id: value_string(detail, &["vlanId", "vlan"]),
        ssid: value_string(detail, &["ssid"]),
        frequency: value_string(detail, &["frequency", "band"]),
        channel: value_string(detail, &["channel"]),
        operating_system: value_string(detail, &["hostOs", "hostVersion"]),
        device_type: value_string(detail, &["subType", "deviceForm"]),
        vendor: value_string(detail, &["deviceVendor", "vendor"]),
        last_updated: detail.get("lastUpdated").and_then(Value::as_i64),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_common_mac_formats() {
        assert_eq!(
            normalize_mac("aabb.ccdd.eeff").unwrap(),
            "AA:BB:CC:DD:EE:FF"
        );
        assert_eq!(
            normalize_mac("aa-bb-cc-dd-ee-ff").unwrap(),
            "AA:BB:CC:DD:EE:FF"
        );
        assert!(normalize_mac("not-a-mac").is_err());
    }

    #[test]
    fn parses_wired_client_detail() {
        let value = json!({
            "detail": {
                "hostName": "LAPTOP-42",
                "hostIpV4": "10.20.30.42",
                "hostMac": "AA:BB:CC:DD:EE:FF",
                "hostType": "Wired",
                "connectionStatus": "CONNECTED",
                "location": "Global/UK/Derby/Main Building/Floor 2",
                "vlanId": 427,
                "healthScore": [{"healthType": "CLIENT-HEALTH", "score": 9, "reason": "Healthy"}],
                "connectedDevice": [{"type": "SWITCH", "name": "DER-ACC-14", "ip address": "10.1.2.14", "interfaceName": "GigabitEthernet1/0/17"}]
            }
        });
        let client = parse_client_detail(&value, "AA:BB:CC:DD:EE:FF").unwrap();
        assert_eq!(client.hostname.as_deref(), Some("LAPTOP-42"));
        assert_eq!(client.health_score, Some(9));
        assert_eq!(client.site.as_deref(), Some("Derby"));
        assert_eq!(client.building.as_deref(), Some("Main Building"));
        assert_eq!(client.floor.as_deref(), Some("Floor 2"));
        assert_eq!(
            client.interface_name.as_deref(),
            Some("GigabitEthernet1/0/17")
        );
    }

    #[test]
    fn parses_wireless_client_detail() {
        let value = json!({
            "detail": {
                "identifier": "phone@example.test",
                "hostMac": "11:22:33:44:55:66",
                "hostType": "Wireless",
                "ssid": "Corporate",
                "frequency": "5 GHz",
                "channel": "44",
                "connectedDevice": [{"type": "AP", "name": "DER-AP-17", "ipAddress": "10.2.3.17"}]
            }
        });
        let client = parse_client_detail(&value, "11:22:33:44:55:66").unwrap();
        assert_eq!(client.connection_type.as_deref(), Some("Wireless"));
        assert_eq!(client.ssid.as_deref(), Some("Corporate"));
        assert_eq!(client.connected_device.as_deref(), Some("DER-AP-17"));
        assert_eq!(client.channel.as_deref(), Some("44"));
    }
}
