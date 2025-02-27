
//get config from file

import { showActiveTab } from "./settings/tab-controls.js";
import { displayTime } from "./widgets/clock.js";

let _config = {
    links: [
        {
            title: "Google",
            url: "https://google.com",
            iconUrl: "https://i.pinimg.com/originals/c8/b8/12/c8b8129127bada9fa699aeba388b3b2b.png",
            linkGroup: 0
        }
    ],

    linkGroups: [
        {
            id: 0,
            name: "Apps"
        }
    ],

    localSettings: {
        tz: "auto",
        timeFormat: "HH:MM",
        dateFormat: ["TT", "MM", "JJ"]
    }

}



function init(config) {
    const linkGridContainer = document.getElementById("link-grid");

    config.links.forEach(link => {
        linkGridContainer.insertAdjacentHTML("afterbegin", /*html*/`
            <a class="link item surface glass" href="${link.url}">
                    <p class="link-title">${link.title}</p>
                    <span class="link-icon center"><img src="${link.iconUrl}" alt=""></span>
            </a>
            `)
    })

    setInterval(() => { displayTime(config.localSettings.timeFormat) }, 250);

    const settingsTabsRadio = document.querySelectorAll('.settings-tabs .item input[type="radio"]')

    Array.from(settingsTabsRadio).forEach(tab => {
        tab.addEventListener('change', () => {
            showActiveTab();
        })
    });

    const addLinkPage = document.querySelector(".add-link-page")

    //exit settings
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            const settings = document.querySelector(".settings");

            if (settings.classList.contains("active")) {
                const children = settings.children;

                for (const child of children) {
                    child.style.opacity = "0";
                    child.style.transform = "translateY(10px)";
                }

                settings.style.backdropFilter = "blur(0px)";
                settings.style.opacity = "0";

                setTimeout(() => {
                    settings.classList.remove("active");

                    for (const child of children) {
                        child.style.opacity = "";
                        child.style.transform = "";
                    }
                    settings.style.backdropFilter = "";
                    settings.style.opacity = "";
                }, 800);

            } else if (addLinkPage.classList.contains("active")){
                setTimeout(() => {
                    addLinkPage.classList.remove("active");

                    /*for (const child of children) {
                        child.style.opacity = "";
                        child.style.transform = "";
                    } */
                    addLinkPage.style.backdropFilter = "";
                    addLinkPage.style.opacity = "";
                }, 800);
            }

        }
    });

    //add link page
    addLinkPage.querySelector(".close").addEventListener('click', () => {
        addLinkPage.classList.remove("active");
    })

    const newLinkUrl = addLinkPage.querySelector("#new-link-url")

    newLinkUrl.addEventListener('keydown', () => {
        //add code here
    })

}

init(_config);

//toggle page edit mode

const editDashboardCheckbox = document.getElementById("edit-dashboard-checkbox")

editDashboardCheckbox.addEventListener("change", () => {
    Array.from(document.getElementsByClassName("edit-page")).forEach(element => {
        element.classList.toggle("hidden")
    })
})

const toggleSettingsCheckbox = document.getElementById("toggle-settings")

toggleSettingsCheckbox.addEventListener("change", () => {
    Array.from(document.getElementsByClassName("settings")).forEach(element => {
        element.classList.toggle("active")
    })
})


//add new link

const addLinkBtn = document.getElementById("add-link")

addLinkBtn.addEventListener('click', () => { document.querySelector(".add-link-page").classList.toggle("active") })