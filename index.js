import { getUserLocation } from './src/location.js';
import { fetchEvents, stopProcessing, hasPosted } from './src/github.js';
import { countdown } from './src/utils.js';

let FEATURE_FLAG_USE_OWN_LOCATION = false;
const GITHUB_EVENTS_PER_PAGE = 100;
const GROSSO_MERDO = 5000;
const GITHUB_FEATURE_FLAG_POST_COMMENTS = false;
const GITHUB_DELETE_COMMENTS_DELAY = 60 * 1000;
const GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY = GITHUB_DELETE_COMMENTS_DELAY + (GITHUB_EVENTS_PER_PAGE * 1000) + GROSSO_MERDO;

async function handleError(e) {
    let message, error, status;

    // If the error is a fetch Response, check status directly for 404, 409, 422, and 502
    if (e && typeof e.status === 'number') {
        if (e.status === 404) {
            console.warn(`GitHub API 404: Resource not found at this endpoint. Skipping this item.`);
            return;
        }
        if (e.status === 409) {
            console.warn(`GitHub API 409: Conflict. The request could not be completed due to a conflict (e.g., branch or merge conflict). Skipping this item.`);
            return;
        }
        if (e.status === 422) {
            console.warn(`GitHub API 422: Unprocessable Entity. The request was well-formed but could not be processed (e.g., invalid commit, validation error). Skipping this item.`);
            return;
        }
        if (e.status === 502) {
            console.warn(`GitHub API 502: Bad Gateway. The server received an invalid response from the upstream server. Skipping this item.`);
            return;
        }
    }

    if (typeof e.json === 'function') {
        try {
            const jsonResponse = await e.json();
            message = jsonResponse.message;
            error = jsonResponse.error || {};
            status = jsonResponse.status || e.status;
        } catch (parseErr) {
            message = e.statusText || e.message || 'Unknown error';
            error = {};
            status = e.status;
        }
    } else {
        message = e.message || 'Unknown error';
        error = e.error || {};
        status = e.status;
    }

    if (typeof error !== 'object' || error === null) error = {};

    if (error && error.status === 304) {
        console.log('No new events');
    } else if (status === 404 || status === 401 || status === 429) {
        console.log(JSON.stringify(e));
        if (message === 'Not Found' || message === "Bad credentials") {
            if (message === "Bad credentials") process.exit(1);
        } else if (error.message && (error.message.includes('Incorrect API key provided:') || error.message.includes('You exceeded your current quota'))) {
            openaiKeys.splice(openaiKeys.indexOf(openaiKey), 1);
            openaiKey = getRandom(openaiKeys);
        }
    } else if (e.headers && e.headers['x-ratelimit-remaining'] === '0') {
        console.log(JSON.stringify(e));
        const resetTime = parseInt(e.headers['x-ratelimit-reset']) * 1000;
        const now = Date.now();
        const retryDelay = Math.max(resetTime - now, 0);
        countdown(retryDelay, 'Rate limit exceeded. Waiting for');
        stopProcessingEvents = true;
        setTimeout(() => fetchEvents(userLocation), retryDelay);
    } else {
        const exitDelay = GITHUB_FEATURE_FLAG_POST_COMMENTS ? GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY : 0;
        console.error('Unhandled error:', e);
        if (e.stack) console.error(e.stack);
        setTimeout(() => {
            process.exit(1);
        }, exitDelay);
    }
}

const main = async function () {
    let userLocation = { lat: 13.714794092120604, lon: 100.5942177061338 };
    try {
        if (FEATURE_FLAG_USE_OWN_LOCATION)
            userLocation = await getUserLocation();
    } catch (error) {
        FEATURE_FLAG_USE_OWN_LOCATION = false;
    }
    if (!FEATURE_FLAG_USE_OWN_LOCATION)
        console.log("Couldn't use own location... striking from Bangkok <3");
    fetchEvents(userLocation);
};

if (process.env._NODE_ENV != "test") {
    main();
}

process.on('SIGINT', function () {
    const exitDelay = hasPosted() ? GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY : 0;
    countdown(exitDelay, 'Caught interrupt signal. Exiting in');
    stopProcessing();
    setTimeout(() => {
        process.exit();
    }, exitDelay)
});

export { _fetch } from './src/utils.js';
