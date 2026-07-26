use super::{wifi_recommendations, WifiDiagnostic};
use std::ffi::c_void;
use std::ptr::{addr_of, null_mut};
use std::slice;

const ERROR_SUCCESS: u32 = 0;
const ERROR_ACCESS_DENIED: u32 = 5;
const ERROR_SERVICE_NOT_ACTIVE: u32 = 1062;
const WLAN_CLIENT_VERSION: u32 = 2;
const WLAN_INTERFACE_STATE_CONNECTED: i32 = 1;
const WLAN_INTF_OPCODE_CURRENT_CONNECTION: i32 = 7;
const WLAN_MAX_NAME_LENGTH: usize = 256;
const DOT11_SSID_MAX_LENGTH: usize = 32;

type WlanHandle = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WlanInterfaceInfo {
    interface_guid: Guid,
    description: [u16; WLAN_MAX_NAME_LENGTH],
    state: i32,
}

#[repr(C)]
struct WlanInterfaceInfoList {
    item_count: u32,
    current_index: u32,
    first_item: WlanInterfaceInfo,
}

#[repr(C)]
struct Dot11Ssid {
    length: u32,
    bytes: [u8; DOT11_SSID_MAX_LENGTH],
}

#[repr(C)]
struct WlanAssociationAttributes {
    ssid: Dot11Ssid,
    bss_type: i32,
    bssid: [u8; 6],
    phy_type: i32,
    phy_index: u32,
    signal_quality: u32,
    rx_rate_kbps: u32,
    tx_rate_kbps: u32,
}

#[repr(C)]
struct WlanSecurityAttributes {
    security_enabled: i32,
    one_x_enabled: i32,
    auth_algorithm: u32,
    cipher_algorithm: u32,
}

#[repr(C)]
struct WlanConnectionAttributes {
    state: i32,
    connection_mode: i32,
    profile_name: [u16; WLAN_MAX_NAME_LENGTH],
    association: WlanAssociationAttributes,
    security: WlanSecurityAttributes,
}

#[link(name = "wlanapi")]
extern "system" {
    fn WlanOpenHandle(
        client_version: u32,
        reserved: *mut c_void,
        negotiated_version: *mut u32,
        client_handle: *mut WlanHandle,
    ) -> u32;
    fn WlanCloseHandle(client_handle: WlanHandle, reserved: *mut c_void) -> u32;
    fn WlanEnumInterfaces(
        client_handle: WlanHandle,
        reserved: *mut c_void,
        interface_list: *mut *mut WlanInterfaceInfoList,
    ) -> u32;
    fn WlanQueryInterface(
        client_handle: WlanHandle,
        interface_guid: *const Guid,
        opcode: i32,
        reserved: *mut c_void,
        data_size: *mut u32,
        data: *mut *mut c_void,
        opcode_value_type: *mut i32,
    ) -> u32;
    fn WlanFreeMemory(memory: *mut c_void);
}

struct ClientHandle(WlanHandle);

impl Drop for ClientHandle {
    fn drop(&mut self) {
        unsafe {
            WlanCloseHandle(self.0, null_mut());
        }
    }
}

struct WlanMemory(*mut c_void);

impl Drop for WlanMemory {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                WlanFreeMemory(self.0);
            }
        }
    }
}

fn wlan_error(operation: &str, code: u32) -> String {
    match code {
        ERROR_ACCESS_DENIED => "Windows denied access to Wi-Fi details. Enable Location services and 'Let desktop apps access your location' in Settings > Privacy & security > Location, then retry.".into(),
        ERROR_SERVICE_NOT_ACTIVE => "Windows WLAN AutoConfig is not running. Start the WLAN AutoConfig service, enable the wireless adapter, and retry.".into(),
        _ => format!("{operation} failed with Windows error {code}"),
    }
}

fn utf16_text(value: &[u16]) -> String {
    let length = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..length])
}

fn ssid_text(ssid: &Dot11Ssid) -> String {
    let length = (ssid.length as usize).min(ssid.bytes.len());
    String::from_utf8_lossy(&ssid.bytes[..length]).into_owned()
}

fn phy_name(phy_type: i32) -> String {
    match phy_type {
        1 => "802.11 FHSS",
        2 => "802.11 DSSS",
        4 => "802.11a",
        5 => "802.11b",
        6 => "802.11g",
        7 => "802.11n",
        8 => "802.11ac",
        9 => "802.11ad",
        10 => "802.11ax",
        11 => "802.11be",
        _ => "Unknown",
    }
    .into()
}

fn security_name(security: &WlanSecurityAttributes) -> String {
    if security.security_enabled == 0 {
        return "Open".into();
    }
    let authentication = match security.auth_algorithm {
        3 => "WPA Enterprise",
        4 => "WPA Personal",
        6 => "WPA2 Enterprise",
        7 => "WPA2 Personal",
        8 => "WPA3 Enterprise",
        9 => "WPA3 Personal",
        10 => "WPA3 Enterprise 192-bit",
        11 => "OWE",
        _ if security.one_x_enabled != 0 => "802.1X",
        _ => "Secured",
    };
    authentication.into()
}

pub fn collect() -> Result<WifiDiagnostic, String> {
    let mut negotiated_version = 0;
    let mut raw_handle = null_mut();
    let open_status = unsafe {
        WlanOpenHandle(
            WLAN_CLIENT_VERSION,
            null_mut(),
            &mut negotiated_version,
            &mut raw_handle,
        )
    };
    if open_status != ERROR_SUCCESS {
        return Err(wlan_error("Opening Windows Wi-Fi diagnostics", open_status));
    }
    let handle = ClientHandle(raw_handle);
    let mut list_pointer = null_mut();
    let enumerate_status = unsafe { WlanEnumInterfaces(handle.0, null_mut(), &mut list_pointer) };
    if enumerate_status != ERROR_SUCCESS {
        return Err(wlan_error(
            "Enumerating wireless adapters",
            enumerate_status,
        ));
    }
    if list_pointer.is_null() {
        return Err("Windows returned no wireless adapters".into());
    }
    let list_memory = WlanMemory(list_pointer.cast());
    let list = unsafe { &*list_pointer };
    let interfaces =
        unsafe { slice::from_raw_parts(addr_of!(list.first_item), list.item_count as usize) };
    let interface = interfaces
        .iter()
        .find(|interface| interface.state == WLAN_INTERFACE_STATE_CONNECTED)
        .or_else(|| interfaces.first())
        .copied()
        .ok_or_else(|| "No Windows wireless adapter was detected".to_string())?;
    let interface_name = utf16_text(&interface.description);
    if interface.state != WLAN_INTERFACE_STATE_CONNECTED {
        drop(list_memory);
        let mut result = WifiDiagnostic {
            platform: "Windows Native Wi-Fi",
            connected: false,
            interface_name: Some(interface_name.clone()),
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
                "Adapter: {interface_name}\nState: Not connected\nSource: Windows Native Wi-Fi API"
            ),
            elapsed_ms: 0,
        };
        result.recommendations = wifi_recommendations(&result);
        return Ok(result);
    }

    let mut data_size = 0;
    let mut data_pointer = null_mut();
    let mut value_type = 0;
    let query_status = unsafe {
        WlanQueryInterface(
            handle.0,
            &interface.interface_guid,
            WLAN_INTF_OPCODE_CURRENT_CONNECTION,
            null_mut(),
            &mut data_size,
            &mut data_pointer,
            &mut value_type,
        )
    };
    if query_status != ERROR_SUCCESS {
        return Err(wlan_error(
            "Reading the current Wi-Fi connection",
            query_status,
        ));
    }
    if data_pointer.is_null() || data_size < std::mem::size_of::<WlanConnectionAttributes>() as u32
    {
        return Err("Windows returned incomplete Wi-Fi connection details".into());
    }
    let data_memory = WlanMemory(data_pointer);
    let connection = unsafe { &*data_pointer.cast::<WlanConnectionAttributes>() };
    let signal_percent = connection.association.signal_quality.min(100) as i32;
    let rssi_dbm = (signal_percent / 2) - 100;
    let ssid = ssid_text(&connection.association.ssid);
    let bssid = connection
        .association
        .bssid
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":");
    let radio_type = phy_name(connection.association.phy_type);
    let security = security_name(&connection.security);
    let tx_rate_mbps = (connection.association.tx_rate_kbps / 1000) as i32;
    let rx_rate_mbps = (connection.association.rx_rate_kbps / 1000) as i32;
    let raw_output = format!(
        "Adapter: {interface_name}\nState: Connected\nSSID: {ssid}\nBSSID: {bssid}\nSignal quality: {signal_percent}%\nEstimated RSSI: {rssi_dbm} dBm\nRadio: {radio_type}\nReceive rate: {rx_rate_mbps} Mbps\nTransmit rate: {tx_rate_mbps} Mbps\nSecurity: {security}\nSource: Windows Native Wi-Fi API"
    );
    drop(data_memory);
    drop(list_memory);
    let mut result = WifiDiagnostic {
        platform: "Windows Native Wi-Fi",
        connected: true,
        interface_name: Some(interface_name),
        ssid: Some(ssid),
        bssid: Some(bssid),
        signal_percent: Some(signal_percent),
        rssi_dbm: Some(rssi_dbm),
        noise_dbm: None,
        snr_db: None,
        channel: None,
        band: None,
        radio_type: Some(radio_type),
        tx_rate_mbps: Some(tx_rate_mbps),
        rx_rate_mbps: Some(rx_rate_mbps),
        security: Some(security),
        nearby_networks: Vec::new(),
        recommendations: Vec::new(),
        raw_output,
        elapsed_ms: 0,
    };
    result.recommendations = wifi_recommendations(&result);
    Ok(result)
}
