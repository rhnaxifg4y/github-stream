import { Agent } from 'undici';
import { styleText } from "util";

export async function _fetch(url, options) {
    const response = await fetch(url, { ...options, dispatcher: new Agent({ connectTimeout: 0, bodyTimeout: 0, headersTimeout: 0 }) });
    if (!response.ok) {
        throw response;
    }
    return response;
}

export function countdown(delay, message) {
    function secondsToString(seconds) {
        var numyears = Math.floor(seconds / 31536000);
        var numdays = Math.floor((seconds % 31536000) / 86400);
        var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
        var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
        var numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
        var result = [];
        if (numyears > 0) result.push(numyears + " years");
        if (numdays > 0) result.push(numdays + " days");
        if (numhours > 0) result.push(numhours + " hours");
        if (numminutes > 0) result.push(numminutes + " minutes");
        if (numseconds > 0) result.push(numseconds + " seconds");
        return result.join(" ");
    }

    let remainingTime = delay;
    const interval = setInterval(() => {
        remainingTime -= 1000;
        process.stdout.write(`\x1b[2K${message} ${secondsToString(parseInt(remainingTime / 1000))}...\r`);
        if (remainingTime < 0)
            clearInterval(interval);
    }, 1000);
}

export function rainbow(str) {
    if (typeof str !== 'string') {
        throw new TypeError('chalk-rainbow expected a string')
    }

    const letters = str.split('')
    const colors = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta']
    const colorsCount = colors.length

    return letters.map((l, i) => {
        const color = colors[i % colorsCount]
        return styleText(color, l)
    }).join('')
}

export const getRandom = (keys) => keys[Math.floor(Math.random() * keys.length)];
