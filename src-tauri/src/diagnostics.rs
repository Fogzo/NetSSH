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
