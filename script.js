
//get config from file

import { getConfig } from "./config/get.js";
import { getPageInfo } from "./move-to-backend/link-preview.js";
import { showActiveTab } from "./settings/tab-controls.js";
import { displayTime } from "./widgets/clock.js";



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

            } else if (addLinkPage.classList.contains("active")) {
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
    const commonregex = /^(?:(?:https?):\/\/)?(?:[a-zA-Z0-9-]+\.)+(?:(?:com)|(?:ai)|(?:de)|(?:org)|(?:net)|(?:st)|(?:ca)|(?:uk)|(?:fr)|(?:br)|(?:io)|(?:horse)|(?:dev))(?::\d{1,5})?(?:\/\S*)?$/;

    const popularLinksSection = document.getElementById("popular-links")
    const linkDetailLoader = document.querySelector(".add-link-page section.loader");
    const linkDetailSection = document.querySelector("link-options")

    newLinkUrl.addEventListener('keyup', () => {
        //add code here
        popularLinksSection.classList.remove("active")

        if (commonregex.test(newLinkUrl.value)) {
            linkDetailLoader.classList.remove("active")
            linkDetailSection.classList.add("active")

            getPageInfo(newLinkUrl.value).then(data => {
                console.log(data)
            })

        } else {
            linkDetailLoader.classList.remove("active")
        }
    })

}

init(getConfig());

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