import { _fetch, getRandom } from "./utils.js";

export async function getUserLocation() {
    const ipifyKey = getRandom(process.env.IPIFY_KEYS.split(',').filter(Boolean));
    if (ipifyKey) {
        const ip = await (await _fetch('https://api.ipify.org')).text();
        const { location } = await (await _fetch('https://geo.ipify.org/api/v2/country?apiKey=' + ipifyKey + '&ipAddress=' + ip)).json();
        const res = await (await _fetch(`https://us1.locationiq.com/v1/search?key=${process.env.LOCATIONIQ_KEY}&q=${encodeURI(location.region + '(' + location.country + ')')}&format=json&`)).json();
        if (res && res.length) {
            console.log(`Striking from ${location.region + ' (' + location.country + ')'} ${`(${res[0].lat}, ${res[0].lon})`}`);
            return res[0];
        } else {
            throw new Error("LMAO");
        }
    }
}

export async function getLocation(location) {
    const res = await (await _fetch(`https://us1.locationiq.com/v1/search?key=${process.env.LOCATIONIQ_KEY}&q=${encodeURI(location)}&format=json&`)).json();
    if (res && res.length) {
        return res[0];
    }
    return null;
}
