const settingsTabs = Array.from(document.querySelectorAll(".settings-content .item"));


export function showActiveTab() {
    const activeSettingsRadio = document.querySelector('input[type="radio"][name="settings-tabs"]:checked')
    
    console.log("Active settings tab: " + activeSettingsRadio.id)

    settingsTabs.forEach(item => {
        item.classList.remove('active')
    })

    settingsTabs.find(item => (item.id == activeSettingsRadio.id.replace("tab-", ""))).classList.add('active')
}