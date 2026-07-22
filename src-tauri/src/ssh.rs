use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPreflightResult {
    reachable: bool,
    banner: Option<String>,
    elapsed_ms: u128,
}

fn validate_target(target: &str, protocol: &str) -> Result<String, String> {
    let target = target.trim();
    if target.is_empty() || target.len() > 253 {
        return Err(format!("Enter a valid {protocol} target"));
    }
    if protocol != "serial"
        && !target.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | ':' | '_')
        })
    {
        return Err(format!("Enter a valid {protocol} hostname or IP address"));
    }
    Ok(target.to_owned())
}

async fn tcp_preflight(
    protocol: &str,
    target: String,
    port: u16,
) -> Result<ConnectionPreflightResult, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535".into());
    }
    let address = format!("{target}:{port}");
    let started = Instant::now();
    let mut stream = timeout(Duration::from_secs(5), TcpStream::connect(&address))
        .await
        .map_err(|_| format!("Connection to {address} timed out"))?
        .map_err(|error| format!("Unable to reach {address}: {error}"))?;
    let connected_at = started.elapsed().as_millis();
    let mut bytes = [0_u8; 255];
    let banner = match timeout(Duration::from_millis(900), stream.read(&mut bytes)).await {
        Ok(Ok(count)) if count > 0 => {
            let value = String::from_utf8_lossy(&bytes[..count])
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_owned();
            if protocol == "ssh" && !value.starts_with("SSH-") {
                return Err(format!(
                    "Port {port} is reachable but did not return an SSH banner"
                ));
            }
            (!value.is_empty()).then_some(value)
        }
        Ok(Err(error)) if protocol == "ssh" => {
            return Err(format!(
                "Connected but could not read the SSH banner: {error}"
            ))
        }
        _ => None,
    };
    Ok(ConnectionPreflightResult {
        reachable: true,
        banner,
        elapsed_ms: connected_at,
    })
}

#[tauri::command]
pub async fn connection_preflight(
    protocol: String,
    target: String,
    port: Option<u16>,
    baud_rate: Option<u32>,
) -> Result<ConnectionPreflightResult, String> {
    if !matches!(protocol.as_str(), "ssh" | "telnet" | "serial") {
        return Err("Unsupported connection protocol".into());
    }
    let target = validate_target(&target, &protocol)?;
    match protocol.as_str() {
        "ssh" => tcp_preflight("ssh", target, port.unwrap_or(22)).await,
        "telnet" => tcp_preflight("telnet", target, port.unwrap_or(23)).await,
        "serial" => {
            let started = Instant::now();
            let display_target = target.clone();
            let rate = baud_rate.unwrap_or(9_600);
            tokio::task::spawn_blocking(move || {
                serialport::new(&target, rate)
                    .timeout(Duration::from_secs(2))
                    .open()
                    .map_err(|error| format!("Unable to open serial port {target}: {error}"))
            })
            .await
            .map_err(|error| format!("Serial preflight failed: {error}"))??;
            Ok(ConnectionPreflightResult {
                reachable: true,
                banner: Some(format!(
                    "Serial port {display_target} opened at {rate} baud"
                )),
                elapsed_ms: started.elapsed().as_millis(),
            })
        }
        _ => unreachable!(),
    }
}
