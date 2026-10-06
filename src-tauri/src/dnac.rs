use keyring::Entry;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const DNAC_KEYRING_SERVICE: &str = "app.netssh.client.dnac";
const DNAC_KEYRING_ACCOUNT: &str = "connection";
const AUTH_PATH: &str = "/dna/system/api/v1/auth/token";
const CLIENT_DETAIL_PATH: &str = "/dna/intent/api/v1/client-detail";
const NETWORK_HEALTH_PATH: &str = "/dna/intent/api/v1/network-health";
const SITE_HEALTH_PATH: &str = "/dna/intent/api/v1/site-health";
const CLIENT_HEALTH_PATH: &str = "/dna/intent/api/v1/client-health";
const DEVICE_HEALTH_PATH: &str = "/dna/intent/api/v1/device-health";
const NETWORK_DEVICE_PATH: &str = "/dna/intent/api/v1/network-device";
const DEVICE_DETAIL_PATH: &str = "/dna/intent/api/v1/device-detail";
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnacNetworkHealthResult {
    retrieved_at: i64,
    overall_score: Option<f64>,
    total_devices: Option<i64>,
    monitored_devices: Option<i64>,
    healthy_devices: Option<i64>,
    unhealthy_devices: Option<i64>,
    fair_devices: Option<i64>,
    poor_devices: Option<i64>,
    unmonitored_devices: Option<i64>,
    categories: Vec<DnacHealthCategory>,
    sites: Vec<DnacSiteHealth>,
    client_health: Vec<DnacClientHealth>,
    devices: Vec<DnacHealthDevice>,
    device_count: Option<i64>,
    devices_truncated: bool,
    site_error: Option<String>,
    client_error: Option<String>,
    device_error: Option<String>,
    inventory_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnacHealthDevice {
    id: Option<String>,
    name: String,
    device_type: Option<String>,
    device_family: Option<String>,
    device_role: Option<String>,
    model: Option<String>,
    management_ip: Option<String>,
    site_hierarchy: Option<String>,
    reachability: Option<String>,
    health_score: Option<i64>,
    issue_count: Option<i64>,
    client_count: Option<i64>,
    software_version: Option<String>,
    serial_number: Option<String>,
    uptime: Option<String>,
}

struct DnacHealthData {
    network: Value,
    sites: Value,
    clients: Value,
    devices: Value,
    inventory: Value,
    devices_truncated: bool,
    site_error: Option<String>,
    client_error: Option<String>,
    device_error: Option<String>,
    inventory_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnacDeviceDetail {
    name: Option<String>,
    device_type: Option<String>,
    device_family: Option<String>,
    model: Option<String>,
    management_ip: Option<String>,
    site_hierarchy: Option<String>,
    reachability: Option<String>,
    health_score: Option<i64>,
    client_count: Option<i64>,
    software_version: Option<String>,
    serial_number: Option<String>,
    uptime: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnacHealthCategory {
    category: String,
    total_count: Option<i64>,
    health_score: Option<f64>,
    good_count: Option<i64>,
    fair_count: Option<i64>,
    poor_count: Option<i64>,
    no_health_count: Option<i64>,
    unmonitored_count: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnacSiteHealth {
    site_name: String,
    site_hierarchy: Option<String>,
    network_health_average: Option<f64>,
    device_count: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnacClientHealth {
    category: String,
    client_count: Option<i64>,
    health_score: Option<f64>,
    scores: Vec<DnacClientHealthScore>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnacClientHealthScore {
    category: String,
    client_count: Option<i64>,
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

async fn health_api_request(
    http: &Client,
    server_url: &str,
    token: &str,
    path: &str,
    query: &[(&str, &str)],
) -> Result<(StatusCode, Value), String> {
    let response = http
        .get(format!("{server_url}{path}"))
        .header("X-Auth-Token", token)
        .header("Accept", "application/json")
        .query(query)
        .send()
        .await
        .map_err(|error| {
            eprintln!("[DNAC] Catalyst Center endpoint {path} request failed: {error}");
            request_error(error)
        })?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read the Catalyst Center health response: {error}"))?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(
        |_| serde_json::json!({ "message": text.chars().take(300).collect::<String>() }),
    );
    Ok((status, body))
}

async fn health_api_snapshot(
    http: &Client,
    server_url: &str,
    token: &str,
) -> (
    Result<(StatusCode, Value), String>,
    Result<(StatusCode, Value), String>,
    Result<(StatusCode, Value), String>,
    Result<(StatusCode, Value), String>,
    Result<(StatusCode, Value), String>,
) {
    tokio::join!(
        health_api_request(http, server_url, token, NETWORK_HEALTH_PATH, &[]),
        health_api_request(http, server_url, token, SITE_HEALTH_PATH, &[]),
        health_api_request(http, server_url, token, CLIENT_HEALTH_PATH, &[]),
        health_api_request(
            http,
            server_url,
            token,
            DEVICE_HEALTH_PATH,
            &[("limit", "500"), ("offset", "1")],
        ),
        health_api_request(
            http,
            server_url,
            token,
            NETWORK_DEVICE_PATH,
            &[("limit", "500"), ("offset", "1")],
        ),
    )
}

fn result_unauthorized(result: &Result<(StatusCode, Value), String>) -> bool {
    matches!(result, Ok((StatusCode::UNAUTHORIZED, _)))
}

fn number_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
}

fn object_number(object: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(number_value))
}

fn object_integer(object: &Map<String, Value>, keys: &[&str]) -> Option<i64> {
    object_number(object, keys).map(|number| number.round() as i64)
}

fn object_sum(object: &Map<String, Value>, key: &str) -> Option<i64> {
    let value = object.get(key)?;
    if let Some(number) = number_value(value) {
        return Some(number.round() as i64);
    }
    let values = value.as_object()?;
    let counts: Vec<i64> = values
        .values()
        .filter_map(number_value)
        .map(|number| number.round() as i64)
        .collect();
    (!counts.is_empty()).then(|| counts.into_iter().sum())
}

fn first_response_object(body: &Value) -> Option<&Map<String, Value>> {
    body.get("response")?
        .as_array()?
        .iter()
        .find_map(Value::as_object)
}

fn body_number(body: &Value, keys: &[&str]) -> Option<f64> {
    body.as_object()
        .and_then(|object| object_number(object, keys))
        .or_else(|| first_response_object(body).and_then(|object| object_number(object, keys)))
}

fn category_label(value: &Value) -> Option<String> {
    value
        .get("scoreCategory")
        .and_then(|category| {
            category
                .get("value")
                .or_else(|| category.get("scoreCategory"))
                .or_else(|| category.as_str().map(|_| category))
        })
        .and_then(|label| match label {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_owned()),
            _ => None,
        })
        .or_else(|| {
            value
                .get("category")
                .or_else(|| value.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .map(str::to_owned)
        })
}

fn parse_health_categories(body: &Value) -> Vec<DnacHealthCategory> {
    let distribution = body
        .get("healthDistirubution")
        .or_else(|| body.get("healthDistribution"))
        .or_else(|| {
            first_response_object(body).and_then(|object| {
                object
                    .get("healthDistirubution")
                    .or_else(|| object.get("healthDistribution"))
            })
        })
        .and_then(Value::as_array);
    distribution
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .map(|object| DnacHealthCategory {
            category: value_string(object, &["category", "entity"])
                .unwrap_or_else(|| "Network".into()),
            total_count: object_integer(object, &["totalCount", "totalDevices"]),
            health_score: object_number(object, &["healthScore"]),
            good_count: object_integer(object, &["goodCount"]),
            fair_count: object_integer(object, &["fairCount"]),
            poor_count: object_integer(object, &["badCount", "poorCount"]),
            no_health_count: object_integer(object, &["noHealthCount"]),
            unmonitored_count: object_integer(object, &["unmonCount", "unmonitoredCount"]),
        })
        .collect()
}

fn parse_site_health(body: &Value) -> Vec<DnacSiteHealth> {
    body.get("response")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .map(|object| DnacSiteHealth {
            site_name: value_string(object, &["siteName", "name"])
                .unwrap_or_else(|| "Unnamed site".into()),
            site_hierarchy: value_string(object, &["siteHierarchy", "sitePath"]),
            network_health_average: object_number(object, &["networkHealthAverage", "healthScore"]),
            device_count: object_integer(
                object,
                &["numberOfDevices", "deviceCount", "totalDeviceCount"],
            ),
        })
        .collect()
}

fn parse_client_health(body: &Value) -> Vec<DnacClientHealth> {
    let rows = body
        .get("response")
        .and_then(Value::as_array)
        .and_then(|response| response.iter().find_map(Value::as_object))
        .and_then(|object| object.get("scoreDetail"))
        .and_then(Value::as_array);
    rows.into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .map(|object| {
            let scores = object
                .get("scoreList")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|score| {
                    let category = category_label(score)?;
                    let score_object = score.as_object()?;
                    Some(DnacClientHealthScore {
                        category,
                        client_count: object_integer(score_object, &["clientCount"]),
                    })
                })
                .collect();
            DnacClientHealth {
                category: category_label(&Value::Object(object.clone()))
                    .unwrap_or_else(|| "Clients".into()),
                client_count: object_integer(object, &["clientCount"]),
                health_score: object_number(object, &["scoreValue"]),
                scores,
            }
        })
        .collect()
}

fn parse_health_devices(body: &Value, inventory: &Value) -> Vec<DnacHealthDevice> {
    let inventory_rows: Vec<&Map<String, Value>> = inventory
        .get("response")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .collect();
    let mut known_ids = HashSet::new();
    let mut known_ips = HashSet::new();
    let mut devices = Vec::new();
    for health in body
        .get("response")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
    {
        let health_id = value_string(health, &["uuid", "id"]);
        let management_ip = value_string(
            health,
            &[
                "ipAddress",
                "managementIpAddress",
                "managementIpAddr",
                "ipV4Addr",
            ],
        );
        let inventory_device = inventory_rows.iter().copied().find(|device| {
            health_id.as_deref().is_some_and(|id| {
                value_string(device, &["id", "instanceUuid", "uuid"]).as_deref() == Some(id)
            }) || management_ip.as_deref().is_some_and(|ip| {
                value_string(
                    device,
                    &["managementIpAddress", "managementAddress", "ipv4Address"],
                )
                .is_some_and(|value| value.eq_ignore_ascii_case(ip))
            })
        });
        let inventory_value =
            |keys: &[&str]| inventory_device.and_then(|device| value_string(device, keys));
        if let Some(id) = health_id.as_ref() {
            known_ids.insert(id.to_ascii_lowercase());
        }
        if let Some(ip) = management_ip.as_ref() {
            known_ips.insert(ip.to_ascii_lowercase());
        }
        if let Some(device) = inventory_device {
            if let Some(id) = value_string(device, &["id", "instanceUuid", "uuid"]) {
                known_ids.insert(id.to_ascii_lowercase());
            }
            if let Some(ip) = value_string(
                device,
                &["managementIpAddress", "managementAddress", "ipv4Address"],
            ) {
                known_ips.insert(ip.to_ascii_lowercase());
            }
        }
        devices.push(DnacHealthDevice {
            id: health_id.or_else(|| inventory_value(&["id", "instanceUuid", "uuid"])),
            name: value_string(health, &["name", "hostname"])
                .or_else(|| inventory_value(&["hostname", "name"]))
                .or_else(|| management_ip.clone())
                .unwrap_or_else(|| "Unnamed device".into()),
            device_type: value_string(health, &["deviceType", "type"])
                .or_else(|| inventory_value(&["deviceType", "type"])),
            device_family: value_string(health, &["deviceFamily", "family"])
                .or_else(|| inventory_value(&["deviceFamily", "family"])),
            device_role: value_string(health, &["deviceRole", "nwDeviceRole", "role"])
                .or_else(|| inventory_value(&["deviceRole", "nwDeviceRole", "role"])),
            model: value_string(health, &["model", "deviceSeries"]).or_else(|| {
                inventory_value(&[
                    "series",
                    "deviceSeries",
                    "model",
                    "platformId",
                    "platformIds",
                ])
            }),
            management_ip: management_ip.or_else(|| {
                inventory_value(&[
                    "managementIpAddress",
                    "managementAddress",
                    "dnsResolvedManagementIpAddress",
                    "ipv4Address",
                ])
            }),
            site_hierarchy: value_string(health, &["siteHierarchy", "location"])
                .or_else(|| inventory_value(&["siteHierarchy", "locationName"])),
            reachability: value_string(health, &["reachabilityHealth", "reachabilityStatus"])
                .or_else(|| value_string(health, &["communicationState"]))
                .or_else(|| inventory_value(&["reachabilityStatus", "communicationState"])),
            health_score: object_integer(health, &["overallHealth", "healthScore"]),
            issue_count: object_integer(health, &["issueCount"]),
            client_count: object_sum(health, "clientCount"),
            software_version: value_string(health, &["osVersion", "softwareVersion"])
                .or_else(|| inventory_value(&["softwareVersion", "osVersion"])),
            serial_number: inventory_value(&["serialNumber", "serialNumbers"]),
            uptime: value_string(health, &["upTime", "uptime"])
                .or_else(|| inventory_value(&["upTime", "uptime"])),
        });
    }

    for device in inventory_rows {
        let id = value_string(device, &["id", "instanceUuid", "uuid"]);
        let management_ip = value_string(
            device,
            &[
                "managementIpAddress",
                "managementAddress",
                "dnsResolvedManagementIpAddress",
                "ipv4Address",
            ],
        );
        if id
            .as_ref()
            .is_some_and(|value| known_ids.contains(&value.to_ascii_lowercase()))
            || management_ip
                .as_ref()
                .is_some_and(|value| known_ips.contains(&value.to_ascii_lowercase()))
        {
            continue;
        }
        if let Some(value) = id.as_ref() {
            known_ids.insert(value.to_ascii_lowercase());
        }
        if let Some(value) = management_ip.as_ref() {
            known_ips.insert(value.to_ascii_lowercase());
        }
        devices.push(DnacHealthDevice {
            id,
            name: value_string(device, &["hostname", "name"])
                .or_else(|| management_ip.clone())
                .unwrap_or_else(|| "Unnamed device".into()),
            device_type: value_string(device, &["deviceType", "type"]),
            device_family: value_string(device, &["deviceFamily", "family"]),
            device_role: value_string(device, &["deviceRole", "nwDeviceRole", "role"]),
            model: value_string(
                device,
                &[
                    "platformId",
                    "platformIds",
                    "series",
                    "deviceSeries",
                    "model",
                ],
            ),
            management_ip,
            site_hierarchy: value_string(device, &["siteHierarchy", "locationName"]),
            reachability: value_string(device, &["reachabilityStatus", "communicationState"]),
            health_score: None,
            issue_count: None,
            client_count: None,
            software_version: value_string(device, &["softwareVersion", "osVersion"]),
            serial_number: value_string(device, &["serialNumber", "serialNumbers"]),
            uptime: value_string(device, &["upTime", "uptime"]),
        });
    }
    devices
}

fn parse_network_health(data: DnacHealthData) -> Result<DnacNetworkHealthResult, String> {
    let DnacHealthData {
        network,
        sites,
        clients,
        devices,
        inventory,
        devices_truncated,
        site_error,
        client_error,
        device_error,
        inventory_error,
    } = data;
    let categories = parse_health_categories(&network);
    let overall_score =
        body_number(&network, &["latestHealthScore", "healthScore"]).or_else(|| {
            categories
                .first()
                .and_then(|category| category.health_score)
        });
    if overall_score.is_none() && categories.is_empty() {
        return Err("Catalyst Center returned no network health summary. Check that Network Health is enabled and your account has access.".into());
    }
    let fair_devices = body_number(&network, &["monitoredFairHealthDevices", "fairCount"])
        .map(|number| number.round() as i64);
    let poor_devices = body_number(
        &network,
        &["monitoredPoorHealthDevices", "badCount", "poorCount"],
    )
    .map(|number| number.round() as i64);
    let healthy_devices = body_number(&network, &["monitoredHealthyDevices", "goodCount"])
        .map(|number| number.round() as i64);
    let unhealthy_devices = body_number(&network, &["monitoredUnHealthyDevices"])
        .map(|number| number.round() as i64)
        .or_else(|| Some(fair_devices.unwrap_or_default() + poor_devices.unwrap_or_default()));
    Ok(DnacNetworkHealthResult {
        retrieved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
        overall_score,
        total_devices: body_number(&network, &["totalDevices", "totalCount"])
            .map(|number| number.round() as i64),
        monitored_devices: body_number(&network, &["monitoredDevices"])
            .map(|number| number.round() as i64),
        healthy_devices,
        unhealthy_devices,
        fair_devices,
        poor_devices,
        unmonitored_devices: body_number(&network, &["unMonitoredDevices", "noHealthDevices"])
            .map(|number| number.round() as i64),
        categories,
        sites: parse_site_health(&sites),
        client_health: parse_client_health(&clients),
        devices: parse_health_devices(&devices, &inventory),
        device_count: body_number(&inventory, &["totalCount"])
            .or_else(|| body_number(&devices, &["totalCount"]))
            .or_else(|| network.get("totalDevices").and_then(number_value))
            .map(|number| number.round() as i64),
        devices_truncated,
        site_error,
        client_error,
        device_error,
        inventory_error,
    })
}

fn optional_health_body(
    result: Result<(StatusCode, Value), String>,
    label: &str,
) -> (Value, Option<String>) {
    match result {
        Ok((status, body)) if status.is_success() => (body, None),
        Ok((status, body)) => {
            let error = status_error(status, &body, label);
            eprintln!("[DNAC] {label} unavailable: {error}");
            (Value::Null, Some(error))
        }
        Err(error) => {
            eprintln!("[DNAC] {label} request failed: {error}");
            (Value::Null, Some(error))
        }
    }
}

async fn fetch_paged_health_body(
    http: &Client,
    server_url: &str,
    token: &str,
    path: &str,
    initial: Result<(StatusCode, Value), String>,
    context: &str,
) -> Result<(Value, bool), String> {
    let (status, mut body) = initial?;
    if !status.is_success() {
        return Err(status_error(status, &body, context));
    }
    let mut rows = body
        .get("response")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let reported_total = body
        .get("totalCount")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let total = reported_total.unwrap_or(usize::MAX);
    let mut offset = 501usize;
    let mut page_count = 0;
    let mut may_have_more = reported_total.map_or(rows.len() == 500, |count| rows.len() < count);
    while may_have_more && rows.len() < total && page_count < 10 {
        let offset_value = offset.to_string();
        let query = [("limit", "500"), ("offset", offset_value.as_str())];
        let (page_status, page_body) =
            health_api_request(http, server_url, token, path, &query).await?;
        if !page_status.is_success() {
            return Err(status_error(page_status, &page_body, context));
        }
        let page_rows = page_body
            .get("response")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if page_rows.is_empty() {
            may_have_more = false;
            break;
        }
        let full_page = page_rows.len() == 500;
        rows.extend(page_rows);
        offset += 500;
        page_count += 1;
        may_have_more = full_page && rows.len() < total;
    }
    let truncated = reported_total.is_some_and(|count| rows.len() < count) || may_have_more;
    body["response"] = Value::Array(rows);
    Ok((body, truncated))
}

#[tauri::command]
pub async fn get_dnac_network_health(
    request: DnacConnectionRequest,
    state: tauri::State<'_, DnacState>,
) -> Result<DnacNetworkHealthResult, String> {
    eprintln!("[DNAC] Loading Catalyst Center Network Health snapshot");
    let (mut http, mut server, mut token) = authenticate(&request, &state, false).await?;
    let (mut network, mut sites, mut clients, mut devices, mut inventory) =
        health_api_snapshot(&http, &server, &token).await;
    if result_unauthorized(&network)
        || result_unauthorized(&sites)
        || result_unauthorized(&clients)
        || result_unauthorized(&devices)
        || result_unauthorized(&inventory)
    {
        *state.token.lock().await = None;
        (http, server, token) = authenticate(&request, &state, true).await?;
        (network, sites, clients, devices, inventory) =
            health_api_snapshot(&http, &server, &token).await;
    }

    let (network_status, network_body) = network?;
    if !network_status.is_success() {
        return Err(status_error(
            network_status,
            &network_body,
            "Network health",
        ));
    }
    let (site_body, site_error) = optional_health_body(sites, "Site health");
    let (client_body, client_error) = optional_health_body(clients, "Client health");
    let (device_body, devices_truncated, device_error) = match fetch_paged_health_body(
        &http,
        &server,
        &token,
        DEVICE_HEALTH_PATH,
        devices,
        "Device health",
    )
    .await
    {
        Ok((body, truncated)) => (body, truncated, None),
        Err(error) => {
            eprintln!("[DNAC] Device health unavailable: {error}");
            (Value::Null, false, Some(error))
        }
    };
    let (inventory_body, inventory_truncated, inventory_error) = match fetch_paged_health_body(
        &http,
        &server,
        &token,
        NETWORK_DEVICE_PATH,
        inventory,
        "Device inventory",
    )
    .await
    {
        Ok((body, truncated)) => (body, truncated, None),
        Err(error) => {
            eprintln!("[DNAC] Device inventory unavailable: {error}");
            (Value::Null, false, Some(error))
        }
    };
    let result = parse_network_health(DnacHealthData {
        network: network_body,
        sites: site_body,
        clients: client_body,
        devices: device_body,
        inventory: inventory_body,
        devices_truncated: devices_truncated || inventory_truncated,
        site_error,
        client_error,
        device_error,
        inventory_error,
    });
    match &result {
        Ok(snapshot) => eprintln!(
            "[DNAC] Network Health loaded: {} devices, {} site records, {} client groups",
            snapshot.devices.len(),
            snapshot.sites.len(),
            snapshot.client_health.len()
        ),
        Err(error) => eprintln!("[DNAC] Network Health snapshot failed: {error}"),
    }
    result
}

fn parse_device_detail(body: &Value) -> Result<DnacDeviceDetail, String> {
    let detail = body
        .get("response")
        .and_then(Value::as_object)
        .ok_or_else(|| "Catalyst Center did not return details for this device".to_string())?;
    Ok(DnacDeviceDetail {
        name: value_string(detail, &["nwDeviceName", "name", "hostname"]),
        device_type: value_string(detail, &["nwDeviceType", "deviceType", "type"]),
        device_family: value_string(detail, &["nwDeviceFamily", "deviceFamily", "family"]),
        model: value_string(detail, &["deviceSeries", "model", "platformId"]),
        management_ip: value_string(
            detail,
            &[
                "managementIpAddr",
                "ip_addr_managementIpAddr",
                "managementIpAddress",
            ],
        ),
        site_hierarchy: value_string(detail, &["siteHierarchy", "locationName"]),
        reachability: value_string(
            detail,
            &[
                "reachabilityHealth",
                "reachabilityStatus",
                "communicationState",
            ],
        ),
        health_score: object_integer(detail, &["overallHealth", "healthScore"]),
        client_count: object_sum(detail, "clientCount"),
        software_version: value_string(detail, &["softwareVersion", "osVersion"]),
        serial_number: value_string(detail, &["serialNumber"]),
        uptime: value_string(detail, &["upTime", "uptime"]),
    })
}

#[tauri::command]
pub async fn get_dnac_device_detail(
    request: DnacConnectionRequest,
    device_id: String,
    state: tauri::State<'_, DnacState>,
) -> Result<DnacDeviceDetail, String> {
    if device_id.trim().is_empty() {
        return Err("Catalyst Center did not provide an ID for this device".into());
    }
    let (mut http, mut server, mut token) = authenticate(&request, &state, false).await?;
    let mut response = http
        .get(format!("{server}{DEVICE_DETAIL_PATH}"))
        .header("X-Auth-Token", &token)
        .header("Accept", "application/json")
        .query(&[("identifier", "uuid"), ("searchBy", device_id.as_str())])
        .send()
        .await
        .map_err(request_error)?;
    if response.status() == StatusCode::UNAUTHORIZED {
        *state.token.lock().await = None;
        (http, server, token) = authenticate(&request, &state, true).await?;
        response = http
            .get(format!("{server}{DEVICE_DETAIL_PATH}"))
            .header("X-Auth-Token", &token)
            .header("Accept", "application/json")
            .query(&[("identifier", "uuid"), ("searchBy", device_id.as_str())])
            .send()
            .await
            .map_err(request_error)?;
    }
    let status = response.status();
    let text = response.text().await.map_err(|error| {
        format!("Unable to read the Catalyst Center device detail response: {error}")
    })?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(
        |_| serde_json::json!({ "message": text.chars().take(300).collect::<String>() }),
    );
    if !status.is_success() {
        return Err(status_error(status, &body, "Device details"));
    }
    parse_device_detail(&body)
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
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| match value {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_owned()),
            Value::Number(number) => Some(number.to_string()),
            Value::Array(values) => values.iter().find_map(|item| match item {
                Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_owned()),
                _ => None,
            }),
            _ => None,
        })
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

    #[test]
    fn parses_network_site_and_client_health_summaries() {
        let network = json!({
            "latestHealthScore": 92,
            "totalDevices": 20,
            "monitoredDevices": 18,
            "monitoredHealthyDevices": 15,
            "monitoredUnHealthyDevices": 3,
            "monitoredFairHealthDevices": 2,
            "monitoredPoorHealthDevices": 1,
            "unMonitoredDevices": 2,
            "healthDistirubution": [{
                "category": "Access",
                "totalCount": 12,
                "healthScore": 90,
                "goodCount": 10,
                "fairCount": 1,
                "badCount": 1,
                "unmonCount": 0
            }]
        });
        let sites = json!({
            "response": [{
                "siteName": "Derby",
                "siteHierarchy": "Global/UK/Derby",
                "networkHealthAverage": 88.5,
                "numberOfDevices": 12
            }]
        });
        let clients = json!({
            "response": [{
                "scoreDetail": [{
                    "scoreCategory": {"value": "Wireless"},
                    "scoreValue": 96,
                    "clientCount": 42,
                    "scoreList": [
                        {"scoreCategory": {"value": "Good"}, "clientCount": 39},
                        {"scoreCategory": {"value": "Poor"}, "clientCount": 3}
                    ]
                }]
            }]
        });
        let devices = json!({
            "totalCount": 1,
            "response": [{
                "uuid": "device-1",
                "name": "DER-ACC-01",
                "deviceType": "Cisco Catalyst Switch",
                "deviceFamily": "Switches and Hubs",
                "model": "C9300-48P",
                "ipAddress": "10.24.0.1",
                "location": "Global/UK/Derby/Floor 3",
                "reachabilityHealth": "Reachable",
                "overallHealth": 6,
                "issueCount": 2,
                "clientCount": {"radio0": 3, "radio1": 2},
                "osVersion": "17.12.4"
            }]
        });
        let inventory = json!({
            "response": [{
                "id": "device-1",
                "managementIpAddress": "10.24.0.1",
                "serialNumber": "FOC1234ABCD",
                "upTime": "12 days"
            }, {
                "id": "device-2",
                "hostname": "DER-AP-02",
                "managementIpAddress": "10.24.0.2",
                "deviceType": "Cisco Access Point",
                "siteHierarchy": "Global/UK/Derby/Floor 3",
                "reachabilityStatus": "Reachable"
            }]
        });

        let parsed = parse_network_health(DnacHealthData {
            network,
            sites,
            clients,
            devices,
            inventory,
            devices_truncated: false,
            site_error: None,
            client_error: None,
            device_error: None,
            inventory_error: None,
        })
        .unwrap();
        assert_eq!(parsed.overall_score, Some(92.0));
        assert_eq!(parsed.total_devices, Some(20));
        assert_eq!(parsed.healthy_devices, Some(15));
        assert_eq!(parsed.categories[0].category, "Access");
        assert_eq!(parsed.categories[0].poor_count, Some(1));
        assert_eq!(parsed.sites[0].site_name, "Derby");
        assert_eq!(parsed.sites[0].network_health_average, Some(88.5));
        assert_eq!(parsed.client_health[0].category, "Wireless");
        assert_eq!(parsed.client_health[0].scores[1].category, "Poor");
        assert_eq!(parsed.client_health[0].scores[1].client_count, Some(3));
        assert_eq!(parsed.devices[0].name, "DER-ACC-01");
        assert_eq!(parsed.devices[0].health_score, Some(6));
        assert_eq!(parsed.devices[0].client_count, Some(5));
        assert_eq!(
            parsed.devices[0].serial_number.as_deref(),
            Some("FOC1234ABCD")
        );
        assert_eq!(
            parsed.devices[0].site_hierarchy.as_deref(),
            Some("Global/UK/Derby/Floor 3")
        );
        assert_eq!(parsed.devices.len(), 2);
        assert_eq!(parsed.devices[1].name, "DER-AP-02");
        assert_eq!(parsed.devices[1].health_score, None);
        assert_eq!(parsed.devices[1].reachability.as_deref(), Some("Reachable"));
    }

    #[test]
    fn parses_available_device_detail_fields() {
        let detail = json!({
            "response": {
                "nwDeviceName": "DER-ACC-01",
                "nwDeviceType": "Switches and Hubs",
                "nwDeviceFamily": "Switches and Hubs",
                "deviceSeries": "C9300-48P",
                "managementIpAddr": "10.24.0.1",
                "serialNumber": "FOC1234ABCD",
                "softwareVersion": "17.12.4",
                "upTime": "12 days",
                "overallHealth": 6,
                "clientCount": 8
            }
        });
        let parsed = parse_device_detail(&detail).unwrap();
        assert_eq!(parsed.name.as_deref(), Some("DER-ACC-01"));
        assert_eq!(parsed.model.as_deref(), Some("C9300-48P"));
        assert_eq!(parsed.serial_number.as_deref(), Some("FOC1234ABCD"));
        assert_eq!(parsed.health_score, Some(6));
        assert_eq!(parsed.client_count, Some(8));
    }
}
