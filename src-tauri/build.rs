fn main() {
    // The version comes from package.json through tauri.conf.json, and tauri-build does not
    // declare it, so without this line the Windows version resource keeps the old number.
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
