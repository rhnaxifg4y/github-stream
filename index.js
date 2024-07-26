import fs from "fs";
import path from "path";
import { styleText } from "util";

import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";

let FEATURE_FLAG_USE_OWN_LOCATION = false;
const GITHUB_EVENTS_PER_PAGE = 100;
const GROSSO_MERDO = 5000;
const FEATURE_FLAG_GENERATE_COMMENTS = true;
const GITHUB_FEATURE_FLAG_POST_COMMENTS = false;
const GITHUB_FEATURE_FLAG_DELETE_COMMENTS = true;
const GITHUB_DELETE_COMMENTS_DELAY = 60 * 1000;
const GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY = GITHUB_DELETE_COMMENTS_DELAY + (GITHUB_EVENTS_PER_PAGE * 1000) + GROSSO_MERDO;

const getRandom = (keys) => keys[Math.floor(Math.random() * keys.length)]
const githubKey = getRandom(process.env._GITHUB_KEYS.split(',').filter(Boolean));
const locationiqKey = getRandom(process.env.LOCATIONIQ_KEYS.split(',').filter(Boolean));
let openaiKeys = process.env.OPENAI_KEYS ? process.env.OPENAI_KEYS.split(',').filter(Boolean) : [];
let openaiKey = getRandom(openaiKeys);

const octokitLogHandler = (e, d) => {
    process.nextTick();
}

Octokit.plugin(throttling);

const octokit = new Octokit({
    log: {
        debug: octokitLogHandler,
        info: octokitLogHandler,
        warn: octokitLogHandler,
        error: octokitLogHandler,
    },
    auth: githubKey,
})

let userLocation = { lat: 33.58535236663171, lon: -7.631805876712778 };

let etag = null;
let lastModified = null;
let pollingInterval = 0;

let stopProcessingEvents = false;
let hasPostedComments = false;

async function getUserLocation() {
    const ipifyKey = getRandom(process.env.IPIFY_KEYS.split(',').filter(Boolean));
    if (ipifyKey) {
        const ip = await (await _fetch('https://api.ipify.org')).text();
        const { location } = await (await _fetch('https://geo.ipify.org/api/v2/country?apiKey=' + ipifyKey + '&ipAddress=' + ip)).json();
        if (stopProcessingEvents) return;
        const res = await (await _fetch(`https://us1.locationiq.com/v1/search?key=${locationiqKey}&q=${encodeURI(location.region + '(' + location.country + ')')}&format=json&`)).json();
        if (res && res.length) {
            userLocation = res[0];
            console.log(`Striking from ${location.region + ' (' + location.country + ')'} ${`(${userLocation.lat}, ${userLocation.lon})`}`);
        } else {
            throw new Error("LMAO");
        }
    }
}

async function fetchEvents() {
    try {
        // https://docs.github.com/en/rest/activity/events?apiVersion=2022-11-28#list-public-events
        const { status, headers, data: events } = await octokit.request('GET /events', {
            'X-GitHub-Api-Version': '2022-11-28',
            'If-None-Match': etag,
            'If-Modified-Since': lastModified
        });
        if (status === 200) {
            etag = headers['etag'];
            lastModified = headers['last-modified'];
            pollingInterval = headers['x-poll-interval'] * 1000;
            for (let i = 0; i < events.length; i++) {
                if (!stopProcessingEvents) {
                    setTimeout(async () => {
                        try {
                            const event = events[i];
                            if (stopProcessingEvents) return;
                            var user
                            // https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28#get-a-user
                            var { data: user } = await octokit.request('GET /users/{username}', {
                                username: event.actor.login,
                                headers: {
                                    'Authorization': `Bearer ${githubKey}`,
                                    'X-GitHub-Api-Version': '2022-11-28'
                                }
                            });
                            if (stopProcessingEvents) return;
                            let output = '', generatedComment = '';
                            let res, lat, long, handlingResult

                            function rainbow(str) {
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

                            try {
                                if (user && user.location) {
                                    if (stopProcessingEvents) return;
                                    const res = await (await _fetch(`https://us1.locationiq.com/v1/search?key=${locationiqKey}&q=${encodeURI(user.location)}&format=json&`)).json();
                                    if (stopProcessingEvents) return;
                                    if (res && res.length) {
                                        const { lat: latitude, lon: longitude } = res[0];
                                        lat = latitude
                                        long = longitude
                                        output += `${rainbow(`(${latitude}, ${longitude})`)} `;
                                    } else {
                                        throw new Error('OMG KESKISPASSE LA LOCATIONIQ')
                                    }
                                } else {
                                    output += `:'( `
                                }
                            } catch (e) {
                                output += 'x| '
                            }

                            output += `${styleText('blue', 'ID:')} ${styleText('green', event.id)} ` +
                                `${styleText('blue', 'Created at:')} ${styleText('green', event.created_at)} ` +
                                `${styleText('blue', 'Type:')} ${styleText('green', event.type)} ` +
                                `${styleText('blue', 'Actor:')} ${styleText('green', event.actor.login)} ` +
                                `${styleText('blue', 'Repo:')} ${styleText('green', event.repo.name)} `;

                            switch (event.type) {
                                case 'CommitCommentEvent':
                                    output += `${styleText('blue', 'Comment URL:')} ${styleText(['underline', 'blue'], event.payload.comment.html_url)} ${event.payload.comment}`;
                                    break;
                                case 'CreateEvent':
                                    output += `${styleText('blue', 'Create URL:')} ${styleText(['underline', 'blue'], event.repo.url)} (${event.payload.ref})`;
                                    break;
                                case 'DeleteEvent':
                                    output += `${styleText('blue', 'Repository URL:')} ${styleText(['underline', 'blue'], event.repo.url)} (${event.payload.ref})`;
                                    break;
                                case 'ForkEvent':
                                    output += `${styleText('blue', 'Fork URL:')} ${styleText(['underline', 'blue'], event.payload.forkee.html_url)}`;
                                    break;
                                case 'GollumEvent':
                                    event.payload.pages.forEach(page => {
                                        output += `${styleText('blue', `Wiki Page (${page.action}):`)} ${styleText(['underline', 'blue'], page.html_url)}`;
                                    });
                                    break;
                                case 'IssueCommentEvent':
                                    output += `${styleText('blue', 'Issue Comment URL:')} ${styleText(['underline', 'blue'], event.payload.comment.html_url)} ${event.payload.comment.body.split('\n').join(' \ ')}`;
                                    break;
                                case 'IssuesEvent':
                                    output += `${styleText('blue', 'Issue URL:')} ${styleText(['underline', 'blue'], event.payload.issue.html_url)} ${event.payload.issue.title} ${event.payload.action}`;
                                    break;
                                case 'MemberEvent':
                                    output += `${styleText('blue', 'Member URL:')} ${styleText(['underline', 'blue'], event.payload.member.html_url)}`;
                                    break;
                                case 'PublicEvent':
                                    output += `${styleText('blue', 'Repository URL:')} ${styleText(['underline', 'blue'], event.repo.url)}`;
                                    break;
                                case 'PullRequestEvent':
                                    output += `${styleText('blue', 'Pull Request URL:')} ${styleText(['underline', 'blue'], event.payload.pull_request.html_url)}`;
                                    break;
                                case 'PullRequestReviewEvent':
                                    output += `${styleText('blue', 'Pull Request Review URL:')} ${styleText(['underline', 'blue'], event.payload.review.html_url)}`;
                                    break;
                                case 'PullRequestReviewCommentEvent':
                                    output += `${styleText('blue', 'Pull Request Review Comment URL:')} ${styleText(['underline', 'blue'], event.payload.comment.html_url)} ${event.payload.comment.body.split('\n').join(' \ ')}`;
                                    break;
                                case 'PullRequestReviewThreadEvent':
                                    output += `${styleText('blue', 'Pull Request Review Thread URL:')} ${styleText(['underline', 'blue'], event.payload.thread.html_url)}`;
                                    break;
                                case 'PushEvent':
                                    // Assuming the first commit in the payload
                                    if (event.payload.commits.length > 0) {
                                        output += `${styleText('blue', 'Commit URL:')} ${styleText(['underline', 'blue'], event.payload.commits[0].url)} ${event.payload.commits[0].message.split('\n').join(' \ ')}`;
                                        if (lat && long && FEATURE_FLAG_GENERATE_COMMENTS) {
                                            handlingResult = await handlePushEvent(event, user.location)
                                            generatedComment = handlingResult.comment
                                        }
                                    }
                                    break;
                                case 'ReleaseEvent':
                                    output += `${styleText('blue', 'Release URL:')} ${styleText(['underline', 'blue'], event.payload.release.html_url)}`;
                                    break;
                                case 'SponsorshipEvent':
                                    output += `${styleText('blue', 'Sponsorship URL:')} ${styleText(['underline', 'blue'], event.payload.sponsorship.html_url)}`;
                                    break;
                                case 'WatchEvent':
                                    output += `${styleText('blue', 'Repository URL:')} ${styleText(['underline', 'blue'], event.repo.url)}`;
                                    break;
                                default:
                                    break;
                            }

                            console.log(output);
                            if (generatedComment)
                                console.log('💡 ' + generatedComment)

                            if (lat && long) {
                                let dataEntry, strikeEntry
                                if (generatedComment) {
                                    strikeEntry = {
                                        uml: user.location,
                                        gm: { lat, lon: long },
                                        uol: user.location,
                                        gop: { lat: userLocation.lat, lon: userLocation.lon },
                                        l: "WHO CARES", // repo dominant language?
                                        a: event.actor.login,
                                        nwo: event.repo.name,
                                        pr: 0, // pr number for link reconstruction?
                                        ma: event.created_at,
                                        oa: new Date().toISOString(), // "We delay the public events feed by five minutes, which means the most recent event returned by the public events API actually occurred at least five minutes ago."
                                        tg: generatedComment,
                                        dce: handlingResult.dce
                                    }
                                } else {
                                    dataEntry = {
                                        uml: user.location,
                                        gm: { lat, lon: long },
                                        uol: user.location,
                                        gop: { lat, lon: long },
                                        l: "WHO CARES",
                                        a: event.actor.login,
                                        nwo: event.repo.name,
                                        pr: 0,
                                        ma: event.created_at,
                                        oa: new Date().toISOString(),
                                        tg: null
                                    }
                                }

                                const dataFilePath = path.join('./globe/data.json');
                                let existingData = [];
                                existingData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
                                if (dataEntry)
                                    existingData.push(dataEntry);
                                if (strikeEntry)
                                    existingData.push(strikeEntry);
                                fs.writeFileSync(dataFilePath, JSON.stringify(existingData, null, 2));
                            }
                        } catch (error) {
                            handleError(error)
                        }
                    }, i * 1000); // Display each event with a 1-second delay
                }
            }
        } else {
            return ;
        }
        setTimeout(fetchEvents, pollingInterval);
    } catch (error) {
        handleError(error)
    }
}

async function handlePushEvent(event, location) {
    let generatedComment;
    const { url } = event.payload.commits[0];
    if (stopProcessingEvents) return;

    const { files } = await (await _fetch(url, {
        headers: { "Authorization": "Bearer " + githubKey }
    })).json();

    if (stopProcessingEvents) return;

    const PROMPT_1 = `
    Write a funny comment from a senior dev on a commit in a post-apocalyptic world. The comment should cause the reader to question how they still work here, mildly insulting, or just rude. Write in all lowercase and keep it short (because this commit isn't worth your time lol).

    Funny example for your inspiration:
    - seriously? we're still coding?
    - this code is more infectious than the virus
    - i think the zombies could write better code

    Be creative!
    `;

    const PROMPT_2 = `
    You are a senior dev reviewing a commit in a post-apocalyptic world. Write a long rant about how the code is terrible, how the author should be banned from any terminal, and how you could fix it with one hand while fighting off mutants with the other. Make it as rude and unhelpful as possible. Write in all lowercase.
    `;

    const PROMPT_3 = `
    You are a senior dev reviewing this commit in a post-apocalyptic world. Write a haiku about the commit. The haiku should reflect on how the code is a disaster, how you're baffled by its existence amidst chaos, or how it's a monument to human folly in the face of global catastrophe.
    `;

    const PROMPTS = [PROMPT_2, PROMPT_2, PROMPT_2, PROMPT_2, PROMPT_1, PROMPT_3];

    const PROMPT_WRAPPER = (prompt, files) => `
    ${prompt}

    You can't be too rude because your boss is watching, but be as unhelpful as possible and
    as rude as you can get away with.

    Here are the diffs for the commit:
    ${files}

    Answer using a sentance in the local language for the following location: "${location}"
    `;
    if (stopProcessingEvents) return;

    const chatbots = []
    if (openaiKeys.length) chatbots.push({ endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' }); // https://platform.openai.com/docs/guides/text-generation/chat-completions-api
    chatbots.push({ endpoint: 'http://127.0.0.1:11434/api/chat', model: 'llama3' });
    const chatbot = getRandom(chatbots);
    
    const data = await (await _fetch(chatbot.endpoint, {
        signal: AbortSignal.timeout(10 * 60 * 1000), // NOTE: might still timeout after 5mn only
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
            model: chatbot.model,
            messages: [
                {
                    role: "system",
                    content: PROMPT_WRAPPER(
                        PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
                        files
                    ),
                }
            ],
            stream: false
        })
    })).json();
    if (stopProcessingEvents) return;

    generatedComment = data.choices ? data.choices[0].message.content : data.message.content;
    if (process.env.RESUME_URL)
        generatedComment = generatedComment + '\n\nanyway... dis you? ' + process.env.RESUME_URL;

    let commentId

    if (GITHUB_FEATURE_FLAG_POST_COMMENTS) {
        hasPostedComments = true;
        if (stopProcessingEvents) return;
        // https://docs.github.com/fr/rest/commits/comments?apiVersion=2022-11-28#create-a-commit-comment
        const { id: commentId } = await (await _fetch(`https://api.github.com/repos/${event.repo.name}/commits/${event.payload.commits[0].sha}/comments`, {
            method: "POST",
            headers: {
                "Accept": "application/vnd.github+json",
                'Authorization': `Bearer ${githubKey}`,
                "X-GitHub-Api-Version": "2022-11-28"
            },
            body: generatedComment
        })).json();

        if (GITHUB_FEATURE_FLAG_DELETE_COMMENTS) {
            hasPostedComments = true;
            setTimeout(async () => {
                try {
                    // https://docs.github.com/fr/rest/commits/comments?apiVersion=2022-11-28#delete-a-commit-comment
                    await _fetch(`https://api.github.com/repos/${event.repo.name}/comments/${commentId}`, {
                        method: "DELETE",
                        headers: {
                            "Accept": "application/vnd.github+json",
                            'Authorization': `Bearer ${githubKey}`,
                            "X-GitHub-Api-Version": "2022-11-28"
                        }
                    })
                } catch (error) {
                    handleError(error);
                }
            }, GITHUB_DELETE_COMMENTS_DELAY)
        }
    }

    return {
        comment: generatedComment,
        dce: commentId && `https://api.github.com/repos/${event.repo.name}/comments/${commentId}`,
    }
}

async function handleError(e) {
    const { message, error } = await error.json();
    if (e.status === 304) {
        console.log('No new events');
    } else if (e.status === 404 || e.status === 401 || e.status === 429) {
        console.log(JSON.stringify(e))
        if (message === 'Not Found' || message === "Bad credentials") { // github
            if (message === "Bad credentials") {
                process.exit();
            }
        }
        else if (error && error.message.indexOf('Incorrect API key provided:') !== -1 || error.message.indexOf('You exceeded your current quota') !== -1) { // openai key issues
            openaiKeys.splice(openaiKeys.indexOf(openaiKey), 1)
            openaiKey = getRandom(openaiKeys);
        }
    } else if (e.headers && e.headers['x-ratelimit-remaining'] === '0') {
        console.log(JSON.stringify(e))
        const resetTime = parseInt(e.headers['x-ratelimit-reset']) * 1000;
        const now = Date.now();
        const retryDelay = Math.max(resetTime - now, 0); // Ensure non-negative delay
        countdown(retryDelay, 'Rate limit exceeded. Waiting for');
        stopProcessingEvents = true;
        setTimeout(fetchEvents, retryDelay);
    } else {
        const exitDelay = GITHUB_FEATURE_FLAG_POST_COMMENTS ? GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY : 0;
        console.error('Unhandled error:', e);
        setTimeout(() => {
            process.exit();
        }, exitDelay)
    }
}

const main = async function () {
    try {
        if (FEATURE_FLAG_USE_OWN_LOCATION)
            await getUserLocation();
    } catch (error) {
        FEATURE_FLAG_USE_OWN_LOCATION = false;
    }
    if (!FEATURE_FLAG_USE_OWN_LOCATION)
        console.log("Couldn't use own location... striking from Casablanca <3");
    fetchEvents();
};

if (process.env._NODE_ENV != "test") {
    main();
}

process.on('SIGINT', function () {
    const exitDelay = hasPostedComments ? GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY : 0;
    countdown(exitDelay, 'Caught interrupt signal. Exiting in');
    stopProcessingEvents = true;
    setTimeout(() => {
        process.exit();
    }, exitDelay)
});

export async function _fetch(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw response;
    }
    return response;
}

function countdown(delay, message) {
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
