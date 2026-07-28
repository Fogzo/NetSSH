use russh::keys::ssh_key::{Algorithm, PublicKey};
use russh::{client, kex};
use serde::Serialize;
use serialport::SerialPortType;
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPreflightResult {
    reachable: bool,
    banner: Option<String>,
    elapsed_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKey {
    fingerprint: String,
    legacy_rsa: bool,
    legacy_kex: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchInterfaceOutput {
    output: String,
    elapsed_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    name: String,
    port_type: String,
    display_name: String,
    manufacturer: Option<String>,
    product: Option<String>,
    serial_number: Option<String>,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
}

#[tauri::command]
pub async fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    tokio::task::spawn_blocking(|| {
        let mut ports = serialport::available_ports()
            .map_err(|error| format!("Unable to inspect serial ports: {error}"))?
            .into_iter()
            .map(|port| {
                let (port_type, manufacturer, product, serial_number, vendor_id, product_id) =
                    match port.port_type {
                        SerialPortType::UsbPort(info) => (
                            "USB".to_string(),
                            info.manufacturer,
                            info.product,
                            info.serial_number,
                            Some(info.vid),
                            Some(info.pid),
                        ),
                        SerialPortType::BluetoothPort => {
                            ("Bluetooth".to_string(), None, None, None, None, None)
                        }
                        SerialPortType::PciPort => {
                            ("PCI".to_string(), None, None, None, None, None)
                        }
                        SerialPortType::Unknown => {
                            ("Serial".to_string(), None, None, None, None, None)
                        }
                    };
                let description = product
                    .as_deref()
                    .or(manufacturer.as_deref())
                    .unwrap_or(&port_type);
                SerialPortInfo {
                    display_name: format!("{} — {description}", port.port_name),
                    name: port.port_name,
                    port_type,
                    manufacturer,
                    product,
                    serial_number,
                    vendor_id,
                    product_id,
                }
            })
            .collect::<Vec<_>>();
        ports.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(ports)
    })
    .await
    .map_err(|error| format!("Serial port discovery stopped unexpectedly: {error}"))?
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    session_id: String,
    kind: &'static str,
    data: String,
}

enum TerminalAction {
    Data(Vec<u8>),
    Resize { columns: u32, rows: u32 },
    Close,
}

#[derive(Clone, Default)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<TerminalAction>>>>,
}

#[derive(Clone)]
struct SshHandler {
    expected_fingerprint: Option<String>,
    observed_fingerprint: Arc<std::sync::Mutex<Option<String>>>,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(Default::default())
            .to_string();
        if let Ok(mut observed) = self.observed_fingerprint.lock() {
            *observed = Some(fingerprint.clone());
        }
        Ok(self
            .expected_fingerprint
            .as_ref()
            .is_none_or(|expected| expected == &fingerprint))
    }
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

fn validate_port(port: u16) -> Result<u16, String> {
    if port == 0 {
        Err("Port must be between 1 and 65535".into())
    } else {
        Ok(port)
    }
}

fn emit_terminal(app: &AppHandle, session_id: &str, kind: &'static str, data: impl Into<String>) {
    let _ = app.emit(
        "terminal-event",
        TerminalEvent {
            session_id: session_id.to_owned(),
            kind,
            data: data.into(),
        },
    );
}

fn ssh_config(legacy_rsa: bool, legacy_kex: bool) -> Arc<client::Config> {
    let mut preferred = russh::Preferred::default();
    if legacy_kex {
        let mut algorithms = preferred.kex.to_vec();
        algorithms
            .retain(|algorithm| *algorithm != kex::DH_G14_SHA1 && *algorithm != kex::DH_G1_SHA1);
        algorithms.insert(0, kex::DH_G1_SHA1);
        algorithms.insert(0, kex::DH_G14_SHA1);
        preferred.kex = Cow::Owned(algorithms);
    }
    if legacy_rsa {
        let mut keys = preferred.key.to_vec();
        if let Some(index) = keys
            .iter()
            .position(|algorithm| matches!(algorithm, Algorithm::Rsa { hash: None }))
        {
            let legacy = keys.remove(index);
            keys.insert(0, legacy);
            preferred.key = Cow::Owned(keys);
        }
    }
    Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60 * 30)),
        preferred,
        nodelay: true,
        ..Default::default()
    })
}

fn no_common_kex_algorithm(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("no common kex algorithm")
        || message.contains("no common key exchange algorithm")
}

async fn tcp_preflight(
    protocol: &str,
    target: String,
    port: u16,
) -> Result<ConnectionPreflightResult, String> {
    let port = validate_port(port)?;
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
pub async fn probe_ssh_host_key(target: String, port: u16) -> Result<SshHostKey, String> {
    let target = validate_target(&target, "ssh")?;
    let port = validate_port(port)?;
    let mut legacy_rsa = false;
    let mut legacy_kex = false;
    let (session, observed_fingerprint) = loop {
        let observed = Arc::new(std::sync::Mutex::new(None));
        let handler = SshHandler {
            expected_fingerprint: None,
            observed_fingerprint: observed.clone(),
        };
        match timeout(
            Duration::from_secs(8),
            client::connect(
                ssh_config(legacy_rsa, legacy_kex),
                (target.as_str(), port),
                handler,
            ),
        )
        .await
        {
            Ok(Ok(session)) => break (session, observed),
            Ok(Err(error)) => {
                let message = error.to_string();
                if no_common_kex_algorithm(&message) && !legacy_kex {
                    legacy_kex = true;
                    continue;
                }
                if message.contains("Wrong server signature") && !legacy_rsa {
                    legacy_rsa = true;
                    continue;
                }
                return Err(format!(
                    "SSH handshake with {target}:{port} failed: {error}"
                ));
            }
            Err(_) => return Err(format!("SSH handshake with {target}:{port} timed out")),
        }
    };
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "Host key probe", "en")
        .await;
    let fingerprint = observed_fingerprint
        .lock()
        .map_err(|_| "Unable to read the SSH host key".to_string())?
        .clone()
        .ok_or_else(|| "The SSH server did not provide a host key".to_string())?;
    Ok(SshHostKey {
        fingerprint,
        legacy_rsa,
        legacy_kex,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn collect_switch_interface_data(
    device_id: String,
    credential_id: Option<String>,
    target: String,
    port: u16,
    username: String,
    password: Option<String>,
    trusted_fingerprint: String,
    legacy_rsa: bool,
    legacy_kex: bool,
) -> Result<SwitchInterfaceOutput, String> {
    let started = Instant::now();
    let target = validate_target(&target, "ssh")?;
    let port = validate_port(port)?;
    let username = username.trim().to_owned();
    if username.is_empty() {
        return Err(
            "Assign a credential profile with a username before running a switch audit".into(),
        );
    }
    let password = super::resolve_login_password(
        password,
        credential_id.as_deref(),
        &device_id,
    )?
        .ok_or_else(|| {
            "The assigned login has no stored password. Enter it in Switch Audit or save it in the Credential vault".to_string()
        })?;
    let observed = Arc::new(std::sync::Mutex::new(None));
    let handler = SshHandler {
        expected_fingerprint: Some(trusted_fingerprint),
        observed_fingerprint: observed,
    };
    let mut handle = timeout(
        Duration::from_secs(10),
        client::connect(
            ssh_config(legacy_rsa, legacy_kex),
            (target.as_str(), port),
            handler,
        ),
    )
    .await
    .map_err(|_| format!("SSH connection to {target}:{port} timed out"))?
    .map_err(|error| format!("SSH connection to {target}:{port} failed: {error}"))?;
    let authentication = handle
        .authenticate_password(&username, &password)
        .await
        .map_err(|error| format!("SSH authentication failed: {error}"))?;
    if !authentication.success() {
        return Err("SSH authentication was rejected for the selected switch".into());
    }
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("Unable to open the audit command channel: {error}"))?;
    channel
        .exec(true, "show interfaces")
        .await
        .map_err(|error| format!("The switch rejected the read-only audit command: {error}"))?;
    let output = timeout(Duration::from_secs(25), async {
        let mut bytes = Vec::new();
        while let Some(message) = channel.wait().await {
            match message {
                russh::ChannelMsg::Data { data } | russh::ChannelMsg::ExtendedData { data, .. } => {
                    bytes.extend_from_slice(&data)
                }
                russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        bytes
    })
    .await
    .map_err(|_| "The switch audit command did not finish within 25 seconds".to_string())?;
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "Audit complete", "en")
        .await;
    let output = String::from_utf8_lossy(&output).to_string();
    if output.trim().is_empty() {
        return Err("The switch returned no interface data".into());
    }
    Ok(SwitchInterfaceOutput {
        output,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_terminal_session(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    session_id: String,
    device_id: String,
    credential_id: Option<String>,
    protocol: String,
    target: String,
    port: Option<u16>,
    baud_rate: Option<u32>,
    username: String,
    password: Option<String>,
    trusted_fingerprint: Option<String>,
    legacy_rsa: bool,
    legacy_kex: bool,
    columns: u32,
    rows: u32,
) -> Result<(), String> {
    if !matches!(protocol.as_str(), "ssh" | "telnet" | "serial") {
        return Err("Unsupported interactive terminal protocol".into());
    }
    let target = validate_target(&target, &protocol)?;
    let username = username.trim().to_owned();
    let mut vault_warning = None;
    let password = if protocol == "serial" {
        password.filter(|value| !value.is_empty())
    } else {
        match super::resolve_login_password(password, credential_id.as_deref(), &device_id) {
            Ok(password) => password,
            Err(error) => {
                vault_warning = Some(error);
                None
            }
        }
    };
    if let Some(warning) = vault_warning {
        emit_terminal(
            &app,
            &session_id,
            "info",
            format!(
                "Saved password unavailable; continuing with terminal authentication. {warning}"
            ),
        );
    }

    if manager.sessions.lock().await.contains_key(&session_id) {
        return Err("A terminal session with this identifier already exists".into());
    }

    let (sender, receiver) = mpsc::channel(64);
    match protocol.as_str() {
        "ssh" => {
            let port = validate_port(port.unwrap_or(22))?;
            let expected = trusted_fingerprint
                .filter(|fingerprint| !fingerprint.trim().is_empty())
                .ok_or_else(|| "Trust the SSH host key before connecting".to_string())?;
            let observed = Arc::new(std::sync::Mutex::new(None));
            let handler = SshHandler {
                expected_fingerprint: Some(expected),
                observed_fingerprint: observed,
            };
            let mut handle = timeout(
                Duration::from_secs(10),
                client::connect(
                    ssh_config(legacy_rsa, legacy_kex),
                    (target.as_str(), port),
                    handler,
                ),
            )
            .await
            .map_err(|_| format!("SSH connection to {target}:{port} timed out"))?
            .map_err(|error| format!("SSH connection to {target}:{port} failed: {error}"))?;
            if username.is_empty() {
                manager
                    .sessions
                    .lock()
                    .await
                    .insert(session_id.clone(), sender);
                let sessions = manager.sessions.clone();
                tokio::spawn(run_ssh_terminal_login(
                    app, sessions, session_id, handle, receiver, columns, rows,
                ));
                return Ok(());
            }
            let authentication = if let Some(password) = password.as_deref() {
                handle
                    .authenticate_password(&username, password)
                    .await
                    .map_err(|error| format!("SSH authentication failed: {error}"))?
            } else {
                handle
                    .authenticate_none(&username)
                    .await
                    .map_err(|error| format!("SSH authentication failed: {error}"))?
            };
            if !authentication.success() {
                manager
                    .sessions
                    .lock()
                    .await
                    .insert(session_id.clone(), sender);
                let sessions = manager.sessions.clone();
                tokio::spawn(run_ssh_keyboard_interactive_auth(
                    app, sessions, session_id, handle, receiver, username, password, columns, rows,
                ));
                return Ok(());
            }
            let channel = handle
                .channel_open_session()
                .await
                .map_err(|error| format!("Unable to open the SSH terminal: {error}"))?;
            channel
                .request_pty(
                    false,
                    "xterm-256color",
                    columns.max(20),
                    rows.max(5),
                    0,
                    0,
                    &[],
                )
                .await
                .map_err(|error| {
                    format!("The SSH server rejected the terminal request: {error}")
                })?;
            channel.request_shell(false).await.map_err(|error| {
                format!("The SSH server rejected the interactive shell: {error}")
            })?;
            manager
                .sessions
                .lock()
                .await
                .insert(session_id.clone(), sender);
            let sessions = manager.sessions.clone();
            tokio::spawn(run_ssh_session(
                app, sessions, session_id, handle, channel, receiver,
            ));
        }
        "telnet" => {
            let port = validate_port(port.unwrap_or(23))?;
            let stream = timeout(
                Duration::from_secs(10),
                TcpStream::connect((target.as_str(), port)),
            )
            .await
            .map_err(|_| format!("Telnet connection to {target}:{port} timed out"))?
            .map_err(|error| format!("Telnet connection to {target}:{port} failed: {error}"))?;
            manager
                .sessions
                .lock()
                .await
                .insert(session_id.clone(), sender);
            let sessions = manager.sessions.clone();
            tokio::spawn(run_telnet_session(
                app,
                sessions,
                session_id,
                stream,
                receiver,
                (!username.is_empty()).then_some(username),
                password,
            ));
        }
        "serial" => {
            let rate = baud_rate.unwrap_or(9_600);
            let display_target = target.clone();
            let serial = serialport::new(&target, rate)
                .timeout(Duration::from_millis(100))
                .open()
                .map_err(|error| format!("Unable to open serial port {target}: {error}"))?;
            manager
                .sessions
                .lock()
                .await
                .insert(session_id.clone(), sender);
            let sessions = manager.sessions.clone();
            tokio::task::spawn_blocking(move || {
                run_serial_session(
                    app,
                    sessions,
                    session_id,
                    display_target,
                    rate,
                    serial,
                    receiver,
                )
            });
        }
        _ => unreachable!(),
    }
    Ok(())
}

async fn run_ssh_terminal_login(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<TerminalAction>>>>,
    session_id: String,
    handle: client::Handle<SshHandler>,
    mut receiver: mpsc::Receiver<TerminalAction>,
    columns: u32,
    rows: u32,
) {
    emit_terminal(&app, &session_id, "data", "\r\nlogin as: ");
    let Some(username) = read_auth_line(&app, &session_id, &mut receiver, true).await else {
        sessions.lock().await.remove(&session_id);
        emit_terminal(&app, &session_id, "closed", "SSH session closed");
        return;
    };
    let username = username.trim().to_owned();
    if username.is_empty() {
        emit_terminal(&app, &session_id, "error", "An SSH username is required");
        sessions.lock().await.remove(&session_id);
        emit_terminal(&app, &session_id, "closed", "SSH session closed");
        return;
    }
    run_ssh_keyboard_interactive_auth(
        app, sessions, session_id, handle, receiver, username, None, columns, rows,
    )
    .await;
}

fn run_serial_session(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<TerminalAction>>>>,
    session_id: String,
    target: String,
    baud_rate: u32,
    mut serial: Box<dyn serialport::SerialPort>,
    mut receiver: mpsc::Receiver<TerminalAction>,
) {
    emit_terminal(
        &app,
        &session_id,
        "connected",
        format!("Serial console connected to {target} at {baud_rate} baud"),
    );
    let mut buffer = [0_u8; 4096];
    'session: loop {
        loop {
            match receiver.try_recv() {
                Ok(TerminalAction::Data(data)) => {
                    if let Err(error) = serial.write_all(&data) {
                        emit_terminal(
                            &app,
                            &session_id,
                            "error",
                            format!("Unable to write to serial console: {error}"),
                        );
                        break 'session;
                    }
                    let _ = serial.flush();
                }
                Ok(TerminalAction::Resize { .. }) => {}
                Ok(TerminalAction::Close) | Err(mpsc::error::TryRecvError::Disconnected) => {
                    break 'session;
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
            }
        }
        match serial.read(&mut buffer) {
            Ok(count) if count > 0 => emit_terminal(
                &app,
                &session_id,
                "data",
                String::from_utf8_lossy(&buffer[..count]).into_owned(),
            ),
            Ok(_) => {}
            Err(error) if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {}
            Err(error) => {
                emit_terminal(
                    &app,
                    &session_id,
                    "error",
                    format!("Serial console error: {error}"),
                );
                break;
            }
        }
    }
    tauri::async_runtime::block_on(async { sessions.lock().await.remove(&session_id) });
    emit_terminal(&app, &session_id, "closed", "Serial console closed");
}

async fn run_ssh_session(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<TerminalAction>>>>,
    session_id: String,
    handle: client::Handle<SshHandler>,
    mut channel: russh::Channel<client::Msg>,
    mut receiver: mpsc::Receiver<TerminalAction>,
) {
    emit_terminal(&app, &session_id, "connected", "SSH session connected");
    loop {
        tokio::select! {
            action = receiver.recv() => match action {
                Some(TerminalAction::Data(data)) => {
                    if let Err(error) = channel.data(data.as_slice()).await {
                        emit_terminal(&app, &session_id, "error", format!("Unable to write to SSH session: {error}"));
                        break;
                    }
                }
                Some(TerminalAction::Resize { columns, rows }) => {
                    let _ = channel.window_change(columns.max(20), rows.max(5), 0, 0).await;
                }
                Some(TerminalAction::Close) | None => break,
            },
            message = channel.wait() => match message {
                Some(russh::ChannelMsg::Data { data }) | Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                    emit_terminal(&app, &session_id, "data", String::from_utf8_lossy(&data).into_owned());
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    emit_terminal(&app, &session_id, "info", format!("Remote shell exited with status {exit_status}"));
                }
                Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
    }
    let _ = channel.close().await;
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "Session closed", "en")
        .await;
    sessions.lock().await.remove(&session_id);
    emit_terminal(&app, &session_id, "closed", "SSH session closed");
}

#[allow(clippy::too_many_arguments)]
async fn run_ssh_keyboard_interactive_auth(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<TerminalAction>>>>,
    session_id: String,
    mut handle: client::Handle<SshHandler>,
    mut receiver: mpsc::Receiver<TerminalAction>,
    username: String,
    saved_password: Option<String>,
    columns: u32,
    rows: u32,
) {
    emit_terminal(
        &app,
        &session_id,
        "data",
        "\r\nSSH keyboard-interactive authentication\r\n",
    );
    let mut response = handle
        .authenticate_keyboard_interactive_start(username.clone(), None)
        .await;
    let keyboard_authenticated = loop {
        match response {
            Ok(client::KeyboardInteractiveAuthResponse::Success) => break true,
            Ok(client::KeyboardInteractiveAuthResponse::Failure { .. }) => break false,
            Ok(client::KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            }) => {
                if !name.trim().is_empty() {
                    emit_terminal(&app, &session_id, "data", format!("{name}\r\n"));
                }
                if !instructions.trim().is_empty() {
                    emit_terminal(&app, &session_id, "data", format!("{instructions}\r\n"));
                }
                let mut answers = Vec::with_capacity(prompts.len());
                for prompt in prompts {
                    emit_terminal(&app, &session_id, "data", prompt.prompt);
                    if !prompt.echo {
                        if let Some(password) = saved_password.as_ref() {
                            emit_terminal(&app, &session_id, "data", "\r\n");
                            answers.push(password.clone());
                            continue;
                        }
                    }
                    let Some(answer) =
                        read_auth_line(&app, &session_id, &mut receiver, prompt.echo).await
                    else {
                        sessions.lock().await.remove(&session_id);
                        emit_terminal(&app, &session_id, "closed", "SSH session closed");
                        return;
                    };
                    answers.push(answer);
                }
                response = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await;
            }
            Err(error) => {
                emit_terminal(
                    &app,
                    &session_id,
                    "info",
                    format!("Keyboard-interactive authentication is unavailable: {error}"),
                );
                break false;
            }
        }
    };

    if !keyboard_authenticated {
        let password = if let Some(password) = saved_password {
            password
        } else {
            emit_terminal(&app, &session_id, "data", "Password: ");
            let Some(password) = read_auth_line(&app, &session_id, &mut receiver, false).await
            else {
                sessions.lock().await.remove(&session_id);
                emit_terminal(&app, &session_id, "closed", "SSH session closed");
                return;
            };
            password
        };
        let authenticated = handle.authenticate_password(username, password).await;
        match authenticated {
            Ok(result) if result.success() => {}
            Ok(_) => {
                emit_terminal(
                    &app,
                    &session_id,
                    "error",
                    "SSH authentication was rejected. Check the username and password.",
                );
                sessions.lock().await.remove(&session_id);
                emit_terminal(&app, &session_id, "closed", "SSH session closed");
                return;
            }
            Err(error) => {
                emit_terminal(
                    &app,
                    &session_id,
                    "error",
                    format!("SSH password authentication failed: {error}"),
                );
                sessions.lock().await.remove(&session_id);
                emit_terminal(&app, &session_id, "closed", "SSH session closed");
                return;
            }
        }
    }

    let channel = match handle.channel_open_session().await {
        Ok(channel) => channel,
        Err(error) => {
            emit_terminal(
                &app,
                &session_id,
                "error",
                format!("Unable to open the SSH terminal: {error}"),
            );
            sessions.lock().await.remove(&session_id);
            return;
        }
    };
    if let Err(error) = channel
        .request_pty(
            false,
            "xterm-256color",
            columns.max(20),
            rows.max(5),
            0,
            0,
            &[],
        )
        .await
    {
        emit_terminal(
            &app,
            &session_id,
            "error",
            format!("The SSH server rejected the terminal request: {error}"),
        );
        sessions.lock().await.remove(&session_id);
        return;
    }
    if let Err(error) = channel.request_shell(false).await {
        emit_terminal(
            &app,
            &session_id,
            "error",
            format!("The SSH server rejected the interactive shell: {error}"),
        );
        sessions.lock().await.remove(&session_id);
        return;
    }
    run_ssh_session(app, sessions, session_id, handle, channel, receiver).await;
}

async fn read_auth_line(
    app: &AppHandle,
    session_id: &str,
    receiver: &mut mpsc::Receiver<TerminalAction>,
    echo: bool,
) -> Option<String> {
    let mut answer = String::new();
    while let Some(action) = receiver.recv().await {
        match action {
            TerminalAction::Data(data) => {
                for byte in data {
                    match byte {
                        b'\r' | b'\n' => {
                            emit_terminal(app, session_id, "data", "\r\n");
                            return Some(answer);
                        }
                        8 | 127 => {
                            if answer.pop().is_some() && echo {
                                emit_terminal(app, session_id, "data", "\x08 \x08");
                            }
                        }
                        32..=126 => {
                            answer.push(char::from(byte));
                            if echo {
                                emit_terminal(
                                    app,
                                    session_id,
                                    "data",
                                    char::from(byte).to_string(),
                                );
                            }
                        }
                        _ => {}
                    }
                }
            }
            TerminalAction::Resize { .. } => {}
            TerminalAction::Close => return None,
        }
    }
    None
}

async fn run_telnet_session(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, mpsc::Sender<TerminalAction>>>>,
    session_id: String,
    stream: TcpStream,
    mut receiver: mpsc::Receiver<TerminalAction>,
    username: Option<String>,
    password: Option<String>,
) {
    let (mut reader, mut writer) = stream.into_split();
    let mut buffer = [0_u8; 4096];
    let mut parser = TelnetParser::default();
    let mut username_sent = false;
    let mut password_sent = false;
    let mut prompt_buffer = String::new();
    emit_terminal(&app, &session_id, "connected", "Telnet session connected");
    loop {
        tokio::select! {
            action = receiver.recv() => match action {
                Some(TerminalAction::Data(data)) => {
                    if let Err(error) = writer.write_all(&data).await {
                        emit_terminal(&app, &session_id, "error", format!("Unable to write to Telnet session: {error}"));
                        break;
                    }
                }
                Some(TerminalAction::Resize { .. }) => {}
                Some(TerminalAction::Close) | None => break,
            },
            read = reader.read(&mut buffer) => match read {
                Ok(0) => break,
                Ok(count) => {
                    let parsed = parser.consume(&buffer[..count]);
                    if !parsed.reply.is_empty() && writer.write_all(&parsed.reply).await.is_err() {
                        break;
                    }
                    if !parsed.output.is_empty() {
                        let output = String::from_utf8_lossy(&parsed.output).into_owned();
                        prompt_buffer.extend(
                            output
                                .chars()
                                .filter(char::is_ascii)
                                .map(|character| character.to_ascii_lowercase()),
                        );
                        if prompt_buffer.len() > 256 {
                            prompt_buffer = prompt_buffer[prompt_buffer.len() - 256..].to_owned();
                        }
                        emit_terminal(&app, &session_id, "data", output);
                        if !username_sent && username.is_some() && (prompt_buffer.contains("username:") || prompt_buffer.contains("login:")) {
                            let _ = writer.write_all(format!("{}\r\n", username.as_deref().unwrap_or_default()).as_bytes()).await;
                            username_sent = true;
                            prompt_buffer.clear();
                        }
                        if !password_sent && password.is_some() && prompt_buffer.contains("password:") {
                            let _ = writer.write_all(format!("{}\r\n", password.as_deref().unwrap_or_default()).as_bytes()).await;
                            password_sent = true;
                            prompt_buffer.clear();
                        }
                    }
                }
                Err(error) => {
                    emit_terminal(&app, &session_id, "error", format!("Telnet connection error: {error}"));
                    break;
                }
            }
        }
    }
    let _ = writer.shutdown().await;
    sessions.lock().await.remove(&session_id);
    emit_terminal(&app, &session_id, "closed", "Telnet session closed");
}

#[derive(Default)]
struct TelnetParser {
    state: TelnetState,
}

#[derive(Default)]
enum TelnetState {
    #[default]
    Data,
    Command,
    Option(u8),
    Subnegotiation,
    SubnegotiationCommand,
}

struct TelnetParseResult {
    output: Vec<u8>,
    reply: Vec<u8>,
}

impl TelnetParser {
    fn consume(&mut self, bytes: &[u8]) -> TelnetParseResult {
        const IAC: u8 = 255;
        const DONT: u8 = 254;
        const DO: u8 = 253;
        const WONT: u8 = 252;
        const WILL: u8 = 251;
        const SB: u8 = 250;
        const SE: u8 = 240;
        let mut output = Vec::with_capacity(bytes.len());
        let mut reply = Vec::new();
        for &byte in bytes {
            self.state = match self.state {
                TelnetState::Data if byte == IAC => TelnetState::Command,
                TelnetState::Data => {
                    output.push(byte);
                    TelnetState::Data
                }
                TelnetState::Command if byte == IAC => {
                    output.push(IAC);
                    TelnetState::Data
                }
                TelnetState::Command if matches!(byte, DO | DONT | WILL | WONT) => {
                    TelnetState::Option(byte)
                }
                TelnetState::Command if byte == SB => TelnetState::Subnegotiation,
                TelnetState::Command => TelnetState::Data,
                TelnetState::Option(command) => {
                    let response = if matches!(command, DO | DONT) {
                        WONT
                    } else {
                        DONT
                    };
                    reply.extend_from_slice(&[IAC, response, byte]);
                    TelnetState::Data
                }
                TelnetState::Subnegotiation if byte == IAC => TelnetState::SubnegotiationCommand,
                TelnetState::Subnegotiation => TelnetState::Subnegotiation,
                TelnetState::SubnegotiationCommand if byte == SE => TelnetState::Data,
                TelnetState::SubnegotiationCommand => TelnetState::Subnegotiation,
            };
        }
        TelnetParseResult { output, reply }
    }
}

#[tauri::command]
pub async fn write_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sender = manager
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "This terminal session is no longer connected".to_string())?;
    sender
        .send(TerminalAction::Data(data.into_bytes()))
        .await
        .map_err(|_| "This terminal session has closed".to_string())
}

#[tauri::command]
pub async fn write_terminal_enable_password(
    manager: State<'_, TerminalManager>,
    session_id: String,
    credential_id: String,
) -> Result<(), String> {
    let password = super::credential_enable_entry(&credential_id)?
        .get_password()
        .map_err(|_| "No enable password is stored for this login profile".to_string())?;
    let sender = manager
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "This terminal session is no longer connected".to_string())?;
    sender
        .send(TerminalAction::Data(format!("{password}\r\n").into_bytes()))
        .await
        .map_err(|_| "This terminal session has closed".to_string())
}

#[tauri::command]
pub async fn resize_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    columns: u32,
    rows: u32,
) -> Result<(), String> {
    let sender = manager
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "This terminal session is no longer connected".to_string())?;
    sender
        .send(TerminalAction::Resize { columns, rows })
        .await
        .map_err(|_| "This terminal session has closed".to_string())
}

#[tauri::command]
pub async fn close_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    if let Some(sender) = manager.sessions.lock().await.remove(&session_id) {
        let _ = sender.send(TerminalAction::Close).await;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telnet_parser_strips_negotiation_and_refuses_options() {
        let parsed =
            TelnetParser::default().consume(&[b'L', b'o', 255, 251, 1, b'g', b'i', b'n', b':']);
        assert_eq!(parsed.output, b"Login:");
        assert_eq!(parsed.reply, vec![255, 254, 1]);
    }

    #[test]
    fn telnet_parser_preserves_escaped_iac() {
        let parsed = TelnetParser::default().consume(&[b'A', 255, 255, b'B']);
        assert_eq!(parsed.output, vec![b'A', 255, b'B']);
    }

    #[test]
    fn legacy_retry_prefers_ssh_rsa_only_when_requested() {
        let modern = ssh_config(false, false);
        let legacy = ssh_config(true, false);
        assert!(!matches!(
            modern.preferred.key[0],
            Algorithm::Rsa { hash: None }
        ));
        assert!(matches!(
            legacy.preferred.key[0],
            Algorithm::Rsa { hash: None }
        ));
    }

    #[test]
    fn legacy_kex_is_added_only_for_compatibility_retry() {
        let modern = ssh_config(false, false);
        let legacy = ssh_config(false, true);
        assert!(!modern.preferred.kex.contains(&kex::DH_G14_SHA1));
        assert!(!modern.preferred.kex.contains(&kex::DH_G1_SHA1));
        assert!(legacy.preferred.kex.contains(&kex::DH_G14_SHA1));
        assert!(legacy.preferred.kex.contains(&kex::DH_G1_SHA1));
        assert_eq!(legacy.preferred.kex[0], kex::DH_G14_SHA1);
    }

    #[test]
    fn legacy_kex_retry_recognises_server_error_variants() {
        assert!(no_common_kex_algorithm("No common Kex Algorithm"));
        assert!(no_common_kex_algorithm(
            "no common kex algorithm: ours diffie-hellman-group17-sha512, theirs diffie-hellman-group14-sha1"
        ));
        assert!(no_common_kex_algorithm("No common key exchange algorithm"));
    }
}
