fn main() {
    // The version comes from package.json through tauri.conf.json, and tauri-build does not
    // declare it, so without this line the Windows version resource keeps the old number.
    println!("cargo:rerun-if-changed=../package.json");
    // Naming the commands here generates an `allow-<command>` permission for each of them
    // and marks the app as having its own ACL manifest. Without that manifest Tauri skips
    // the ACL for app commands, so any script that reached the IPC layer could call them.
    let app_manifest =
        tauri_build::AppManifest::new().commands(&["auth_nonce", "auth_token", "eth_usdt_price"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to run tauri-build");
}
