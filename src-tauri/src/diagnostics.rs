use serde::Serialize;
use std::collections::BTreeSet;
use std::process::Command;
use std::time::{Duration, Instant};
use tokio::net::{lookup_host, TcpStream};
use tokio::time::timeout;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticResult {
    tool: &'static str,
    target: String,
    success: bool,
    output: String,
    elapsed_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetwork {
    ssid: String,
    bssid: Option<String>,
    signal_percent: Option<i32>,
    estimated_rssi_dbm: Option<i32>,
    channel: Option<String>,
    radio_type: Option<String>,
    security: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiDiagnostic {
    platform: &'static str,
    connected: bool,
    interface_name: Option<String>,
    ssid: Option<String>,
    bssid: Option<String>,
    signal_percent: Option<i32>,
    rssi_dbm: Option<i32>,
    noise_dbm: Option<i32>,
    snr_db: Option<i32>,
    channel: Option<String>,
    band: Option<String>,
    radio_type: Option<String>,
    tx_rate_mbps: Option<i32>,
    rx_rate_mbps: Option<i32>,
    security: Option<String>,
    nearby_networks: Vec<WifiNetwork>,
    recommendations: Vec<String>,
    raw_output: String,
    elapsed_ms: u128,
}

fn validate_target(target: &str) -> Result<String, String> {
    let target = target.trim();
    if target.is_empty() || target.len() > 253 {
        return Err("Enter a valid hostname or IP address".into());
    }
    if !target.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | ':' | '_')
    }) {
        return Err("The target contains unsupported characters".into());
    }
    Ok(target.to_owned())
}

async fn run_process(
    tool: &'static str,
    target: String,
    program: &'static str,
    arguments: Vec<String>,
) -> Result<DiagnosticResult, String> {
    let started = Instant::now();
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(program).args(arguments).output()
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("Unable to run {program}: {error}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok(DiagnosticResult {
        tool,
        target,
        success: output.status.success(),
        output: text.trim().to_owned(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn run_ping(target: String) -> Result<DiagnosticResult, String> {
    let target = validate_target(&target)?;
    #[cfg(target_os = "windows")]
    let arguments = vec![
        "-n".into(),
        "4".into(),
        "-w".into(),
        "1500".into(),
        target.clone(),
    ];
    #[cfg(not(target_os = "windows"))]
    let arguments = vec![
        "-c".into(),
        "4".into(),
        "-W".into(),
        "1500".into(),
        target.clone(),
    ];
    run_process("ping", target, "ping", arguments).await
}

#[tauri::command]
pub async fn run_trace(target: String) -> Result<DiagnosticResult, String> {
    let target = validate_target(&target)?;
    #[cfg(target_os = "windows")]
    let (program, arguments) = (
        "tracert",
        vec![
            "-d".into(),
            "-h".into(),
            "16".into(),
            "-w".into(),
            "1200".into(),
            target.clone(),
        ],
    );
    #[cfg(not(target_os = "windows"))]
    let (program, arguments) = (
        "traceroute",
        vec![
            "-n".into(),
            "-m".into(),
            "16".into(),
            "-w".into(),
            "1".into(),
            target.clone(),
        ],
    );
    run_process("trace", target, program, arguments).await
}

#[tauri::command]
pub async fn run_dns_lookup(target: String) -> Result<DiagnosticResult, String> {
    let target = validate_target(&target)?;
    let started = Instant::now();
    let addresses = timeout(Duration::from_secs(8), lookup_host((target.as_str(), 0)))
        .await
        .map_err(|_| "DNS lookup timed out".to_string())?
        .map_err(|error| format!("DNS lookup failed: {error}"))?;
    let unique = addresses
        .map(|address| address.ip())
        .collect::<BTreeSet<_>>();
    let output = if unique.is_empty() {
        "No A or AAAA records found".into()
    } else {
        unique
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    Ok(DiagnosticResult {
        tool: "dns",
        target,
        success: !unique.is_empty(),
        output,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[tauri::command]
pub async fn run_port_check(target: String, port: u16) -> Result<DiagnosticResult, String> {
    let target = validate_target(&target)?;
    if port == 0 {
        return Err("Port must be between 1 and 65535".into());
    }
    let started = Instant::now();
    let address = format!("{target}:{port}");
    match timeout(Duration::from_secs(5), TcpStream::connect(&address)).await {
        Ok(Ok(_)) => Ok(DiagnosticResult {
            tool: "port",
            target,
            success: true,
            output: format!("TCP connection to port {port} succeeded"),
            elapsed_ms: started.elapsed().as_millis(),
        }),
        Ok(Err(error)) => Ok(DiagnosticResult {
            tool: "port",
            target,
            success: false,
            output: format!("TCP connection to port {port} failed: {error}"),
            elapsed_ms: started.elapsed().as_millis(),
        }),
        Err(_) => Ok(DiagnosticResult {
            tool: "port",
            target,
            success: false,
            output: format!("TCP connection to port {port} timed out after 5 seconds"),
            elapsed_ms: started.elapsed().as_millis(),
        }),
    }
}

fn field_value(line: &str) -> Option<(&str, &str)> {
    line.trim()
        .split_once(':')
        .map(|(key, value)| (key.trim(), value.trim()))
}

fn integer_values(value: &str) -> Vec<i32> {
    value
        .split(|character: char| !character.is_ascii_digit() && character != '-')
        .filter(|part| !part.is_empty() && *part != "-")
        .filter_map(|part| part.parse().ok())
        .collect()
}

#[cfg(target_os = "windows")]
fn percent_value(value: &str) -> Option<i32> {
    integer_values(value)
        .first()
        .copied()
        .map(|value| value.clamp(0, 100))
}

#[cfg(target_os = "windows")]
fn estimate_rssi(percent: i32) -> i32 {
    (percent / 2) - 100
}

fn infer_band(channel: &str) -> Option<String> {
    let lower = channel.to_ascii_lowercase();
    if lower.contains("6ghz") {
        return Some("6 GHz".into());
    }
    if lower.contains("5ghz") {
        return Some("5 GHz".into());
    }
    if lower.contains("2ghz") || lower.contains("2.4ghz") {
        return Some("2.4 GHz".into());
    }
    integer_values(channel).first().map(|number| {
        if *number <= 14 {
            "2.4 GHz".into()
        } else if *number <= 196 {
            "5 GHz".into()
        } else {
            "6 GHz".into()
        }
    })
}

fn wifi_recommendations(result: &WifiDiagnostic) -> Vec<String> {
    let mut recommendations = Vec::new();
    if !result.connected {
        recommendations.push("No active Wi-Fi connection was detected. Confirm the adapter is enabled and associated.".into());
        return recommendations;
    }
    if let Some(rssi) = result.rssi_dbm {
        recommendations.push(if rssi >= -67 {
            "RSSI is suitable for normal data and real-time voice traffic.".into()
        } else if rssi >= -75 {
            "RSSI is marginal. Check distance, attenuation, antenna placement, and roaming behaviour.".into()
        } else {
            "RSSI is weak. Move closer to the AP and investigate coverage or antenna issues.".into()
        });
    } else if let Some(signal) = result.signal_percent {
        recommendations.push(if signal >= 60 {
            "Reported signal quality is suitable for normal use.".into()
        } else {
            "Reported signal quality is low. Check coverage, attenuation, and roaming behaviour."
                .into()
        });
    } else {
        recommendations.push("The operating system did not expose RSSI. Check Wi-Fi privacy or Location Services permissions.".into());
    }
    if let Some(snr) = result.snr_db {
        if snr < 20 {
            recommendations.push("SNR is below 20 dB. Investigate interference, channel utilisation, and noise sources.".into());
        } else if snr < 25 {
            recommendations.push(
                "SNR is usable but marginal for high-throughput or real-time applications.".into(),
            );
        } else {
            recommendations.push("SNR is healthy at 25 dB or greater.".into());
        }
    }
    if let Some(channel) = result.channel.as_deref() {
        let same_channel = result
            .nearby_networks
            .iter()
            .filter(|network| network.channel.as_deref() == Some(channel))
            .count();
        if same_channel > 1 {
            recommendations.push(format!(
                "{same_channel} nearby BSSIDs were observed on channel {channel}; inspect channel utilisation and co-channel contention."
            ));
        }
    }
    recommendations
}

#[cfg(target_os = "windows")]
fn collect_wifi_diagnostic() -> Result<WifiDiagnostic, String> {
    let interfaces = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .output()
        .map_err(|error| format!("Unable to inspect Wi-Fi interfaces: {error}"))?;
    let interface_text = String::from_utf8_lossy(&interfaces.stdout).into_owned();
    if !interfaces.status.success() {
        return Err(String::from_utf8_lossy(&interfaces.stderr)
            .trim()
            .to_owned());
    }

    let mut result = WifiDiagnostic {
        platform: "Windows",
        connected: false,
        interface_name: None,
        ssid: None,
        bssid: None,
        signal_percent: None,
        rssi_dbm: None,
        noise_dbm: None,
        snr_db: None,
        channel: None,
        band: None,
        radio_type: None,
        tx_rate_mbps: None,
        rx_rate_mbps: None,
        security: None,
        nearby_networks: Vec::new(),
        recommendations: Vec::new(),
        raw_output: format!(
            "{interface_text}\n\nFast link check: nearby-network scanning is skipped to avoid blocking Windows WLAN diagnostics."
        ),
        elapsed_ms: 0,
    };
    for line in interface_text.lines() {
        let Some((key, value)) = field_value(line) else {
            continue;
        };
        match key.to_ascii_lowercase().as_str() {
            "name" => result.interface_name = Some(value.into()),
            "state" => result.connected = value.eq_ignore_ascii_case("connected"),
            "ssid" => result.ssid = Some(value.into()),
            "bssid" => result.bssid = Some(value.into()),
            "signal" => {
                result.signal_percent = percent_value(value);
                result.rssi_dbm = result.signal_percent.map(estimate_rssi);
            }
            "channel" => {
                result.channel = Some(value.into());
                result.band = infer_band(value);
            }
            "radio type" => result.radio_type = Some(value.into()),
            "transmit rate (mbps)" => result.tx_rate_mbps = integer_values(value).first().copied(),
            "receive rate (mbps)" => result.rx_rate_mbps = integer_values(value).first().copied(),
            "authentication" => result.security = Some(value.into()),
            _ => {}
        }
    }
    result.recommendations = wifi_recommendations(&result);
    Ok(result)
}

#[cfg(target_os = "macos")]
fn collect_wifi_diagnostic() -> Result<WifiDiagnostic, String> {
    let output = Command::new("/usr/sbin/system_profiler")
        .arg("SPAirPortDataType")
        .output()
        .map_err(|error| format!("Unable to inspect Wi-Fi: {error}"))?;
    let profiler_text = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let airport = Command::new(
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport",
    )
    .arg("-I")
    .output()
    .ok();
    let airport_text = airport
        .as_ref()
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
        .unwrap_or_default();
    let text = if airport_text.trim().is_empty() {
        profiler_text.clone()
    } else {
        format!("{profiler_text}\n\nAirPort radio telemetry\n{airport_text}")
    };
    let mut result = WifiDiagnostic {
        platform: "macOS",
        connected: false,
        interface_name: None,
        ssid: None,
        bssid: None,
        signal_percent: None,
        rssi_dbm: None,
        noise_dbm: None,
        snr_db: None,
        channel: None,
        band: None,
        radio_type: None,
        tx_rate_mbps: None,
        rx_rate_mbps: None,
        security: None,
        nearby_networks: Vec::new(),
        recommendations: Vec::new(),
        raw_output: text.clone(),
        elapsed_ms: 0,
    };
    let mut interfaces_found = false;
    let mut current_network = false;
    for line in profiler_text.lines() {
        let trimmed = line.trim();
        if trimmed == "Interfaces:" {
            interfaces_found = true;
            continue;
        }
        if trimmed == "Current Network Information:" {
            current_network = true;
            result.connected = true;
            continue;
        }
        if interfaces_found && result.interface_name.is_none() && trimmed.ends_with(':') {
            result.interface_name = Some(trimmed.trim_end_matches(':').into());
            continue;
        }
        if current_network && result.ssid.is_none() && trimmed.ends_with(':') {
            result.ssid = Some(trimmed.trim_end_matches(':').into());
            continue;
        }
        let Some((key, value)) = field_value(trimmed) else {
            continue;
        };
        match key.to_ascii_lowercase().as_str() {
            "status" => result.connected = value.to_ascii_lowercase().contains("connected"),
            "ssid" => {
                result.ssid = Some(value.into());
                result.connected = true;
            }
            "bssid" => result.bssid = Some(value.into()),
            "signal / noise" => {
                let values = integer_values(value);
                result.rssi_dbm = values.first().copied();
                result.noise_dbm = values.get(1).copied();
                result.snr_db = result
                    .rssi_dbm
                    .zip(result.noise_dbm)
                    .map(|(signal, noise)| signal - noise);
            }
            "channel" => {
                result.channel = integer_values(value).first().map(ToString::to_string);
                result.band = infer_band(value);
            }
            "phy mode" => result.radio_type = Some(value.into()),
            "transmit rate" => result.tx_rate_mbps = integer_values(value).first().copied(),
            "security" => result.security = Some(value.into()),
            _ => {}
        }
    }
    for line in airport_text.lines() {
        let Some((key, value)) = field_value(line) else {
            continue;
        };
        match key.to_ascii_lowercase().as_str() {
            "agrctlrssi" => result.rssi_dbm = integer_values(value).first().copied(),
            "agrctlnoise" => result.noise_dbm = integer_values(value).first().copied(),
            "state" => result.connected = value.eq_ignore_ascii_case("running"),
            "ssid" => {
                if !value.is_empty() {
                    result.ssid = Some(value.into());
                    result.connected = true;
                }
            }
            "bssid" => result.bssid = (!value.is_empty()).then(|| value.into()),
            "channel" => {
                result.channel = integer_values(value).first().map(ToString::to_string);
                result.band = infer_band(value);
            }
            "lasttxrate" => result.tx_rate_mbps = integer_values(value).first().copied(),
            "link auth" | "802.11 auth" => result.security = Some(value.into()),
            "op mode" => result.radio_type = Some(value.into()),
            _ => {}
        }
    }
    result.snr_db = result
        .rssi_dbm
        .zip(result.noise_dbm)
        .map(|(signal, noise)| signal - noise);
    result.recommendations = wifi_recommendations(&result);
    Ok(result)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn collect_wifi_diagnostic() -> Result<WifiDiagnostic, String> {
    Err("Wi-Fi diagnostics currently support Windows and macOS".into())
}

#[tauri::command]
pub async fn run_wifi_diagnostic() -> Result<WifiDiagnostic, String> {
    let started = Instant::now();
    #[cfg(target_os = "windows")]
    let maximum_duration = Duration::from_secs(6);
    #[cfg(not(target_os = "windows"))]
    let maximum_duration = Duration::from_secs(15);
    let mut result = timeout(
        maximum_duration,
        tauri::async_runtime::spawn_blocking(collect_wifi_diagnostic),
    )
    .await
    .map_err(|_| {
        "Wi-Fi inspection timed out. Confirm the Windows WLAN AutoConfig service is running."
            .to_string()
    })?
    .map_err(|error| error.to_string())??;
    result.elapsed_ms = started.elapsed().as_millis();
    Ok(result)
}
