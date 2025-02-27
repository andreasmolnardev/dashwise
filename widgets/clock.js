const displayTimeField = document.getElementById("time-now");

export function displayTime(timeFormat) {
    const now = new Date();

    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    let time = "";

    switch (timeFormat) {
        case "HH:MM":
            time = hours + ':' + minutes;
            break;
        case "HH:MM:SS":
            time = hours + ':' + minutes + ':' + seconds
            break;
        case "HH:MM XM":
            if (hours > 12) {
                time = (hours - 12) + ':' + minutes + " PM"
            } else {
                time = hours + ':' + minutes + "AM"
            }
            break;
        case "HH:MM:SS XM":
            if (hours > 12) {
                time = (hours - 12) + ':' + minutes + ':' + seconds + " PM"
            } else {
                time = hours + ':' + minutes + ':' + seconds + "AM"
            }
            break;
    }

    displayTimeField.innerText = time;

}