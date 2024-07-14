import 'dotenv/config';
import util from "util";
import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";
import NodeGeocoder from 'node-geocoder';
import chalk from "chalk";
import chalkRainbow from 'chalk-rainbow';
import debug from "debug";
import path from "path";
import fs from "fs";
import axios from 'axios';

const GITHUB_EVENTS_PER_PAGE = 100;
const GROSSO_MERDO = 5000;
const OPENAI_FEATURE_FLAG_GENERATE_COMMENTS = true;
const GITHUB_FEATURE_FLAG_POST_COMMENTS = false;
const GITHUB_FEATURE_FLAG_DELETE_COMMENTS = true;
const GITHUB_DELETE_COMMENTS_DELAY = 60 * 1000;
const GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY = GITHUB_DELETE_COMMENTS_DELAY + (GITHUB_EVENTS_PER_PAGE * 1000) + GROSSO_MERDO;

const getRandomKey = (keys) => keys[Math.floor(Math.random() * keys.length)]
const githubKey = getRandomKey(process.env.GITHUB_KEYS.split(','));
const locationiqKey = getRandomKey(process.env.LOCATIONIQ_KEYS.split(','));
const openaiKey = getRandomKey(process.env.OPENAI_KEYS.split(','));

const logGitHub = debug('github');
const logLocationIQ = debug('locationiq');
const logOpenAI = debug('openai');

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

let etag = null;
let lastModified = null;
let pollingInterval = 0;

let stopProcessingEvents = false;

async function fetchEvents() {
    try {
        const headers = {
            'X-GitHub-Api-Version': '2022-11-28'
        };
        if (etag) {
            headers['If-None-Match'] = etag;
        }
        if (lastModified) {
            headers['If-Modified-Since'] = lastModified;
        }

        const response = await octokit.request('GET /events', { headers });
        if (response.status === 200) {
            etag = response.headers['etag'];
            lastModified = response.headers['last-modified'];
            pollingInterval = response.headers['x-poll-interval'] * 1000;
            const events = response.data;
            for (let i = 0; i < events.length; i++) {
                if (!stopProcessingEvents) {
                    setTimeout(async () => {
                        const event = events[i];
                        if (stopProcessingEvents) return ;
                        const userProfile = await octokit.request('GET /users/{username}', {
                            username: event.actor.login,
                            headers: {
                                'Authorization': `Bearer ${githubKey}`,
                                'X-GitHub-Api-Version': '2022-11-28'
                            }
                        });
                        if (stopProcessingEvents) return ;
                        let output = '', generatedComment = '';
                        let res, lat, long, commentResponse
                        try {
                            if (userProfile.data && userProfile.data.location) {
                                const geocoder = NodeGeocoder({ provider: 'locationiq', apiKey: locationiqKey });
                                if (stopProcessingEvents) return ;
                                res = await geocoder.geocode(userProfile.data.location);
                                if (stopProcessingEvents) return ;
                                if (res && res.length) {
                                    const { latitude, longitude } = res[0];
                                    lat = latitude
                                    long = longitude
                                    output += `${chalkRainbow(`(${latitude}, ${longitude})`)} `;
                                } else {
                                    logLocationIQ('HALOOOO', userProfile.data.location, res)
                                    throw new Error('OMG KESKISPASSE LA LOCATIONIQ')
                                }
                            } else {
                                output += `:'( `
                            }
                        } catch (e) {
                            output += 'x| '
                        }

                        output += `${chalk.blue('ID:')} ${chalk.green(event.id)} ` +
                                    `${chalk.blue('Created at:')} ${chalk.green(event.created_at)} ` +
                                    `${chalk.blue('Type:')} ${chalk.green(event.type)} ` +
                                    `${chalk.blue('Actor:')} ${chalk.green(event.actor.login)} ` +
                                    `${chalk.blue('Repo:')} ${chalk.green(event.repo.name)} `;

                        switch (event.type) {
                            case 'CommitCommentEvent':
                                output += `${chalk.blue('Comment URL:')} ${chalk.underline.blue(event.payload.comment.html_url)} ${event.payload.comment}`;
                                break;
                            case 'CreateEvent':
                                output += `${chalk.blue('Create URL:')} ${chalk.underline.blue(event.repo.url)} (${event.payload.ref})`;
                                break;
                            case 'DeleteEvent':
                                output += `${chalk.blue('Repository URL:')} ${chalk.underline.blue(event.repo.url)} (${event.payload.ref})`;
                                break;
                            case 'ForkEvent':
                                output += `${chalk.blue('Fork URL:')} ${chalk.underline.blue(event.payload.forkee.html_url)}`;
                                break;
                            case 'GollumEvent':
                                event.payload.pages.forEach(page => {
                                    output += `${chalk.blue(`Wiki Page (${page.action}):`)} ${chalk.underline.blue(page.html_url)}`;
                                });
                                break;
                            case 'IssueCommentEvent':
                                output += `${chalk.blue('Issue Comment URL:')} ${chalk.underline.blue(event.payload.comment.html_url)} ${event.payload.comment.body.split('\n').join(' \ ')}`;
                                break;
                            case 'IssuesEvent':
                                output += `${chalk.blue('Issue URL:')} ${chalk.underline.blue(event.payload.issue.html_url)} ${event.payload.issue.title} ${event.payload.action}`;
                                break;
                            case 'MemberEvent':
                                output += `${chalk.blue('Member URL:')} ${chalk.underline.blue(event.payload.member.html_url)}`;
                                break;
                            case 'PublicEvent':
                                output += `${chalk.blue('Repository URL:')} ${chalk.underline.blue(event.repo.url)}`;
                                break;
                            case 'PullRequestEvent':
                                output += `${chalk.blue('Pull Request URL:')} ${chalk.underline.blue(event.payload.pull_request.html_url)}`;
                                break;
                            case 'PullRequestReviewEvent':
                                output += `${chalk.blue('Pull Request Review URL:')} ${chalk.underline.blue(event.payload.review.html_url)}`;
                                break;
                            case 'PullRequestReviewCommentEvent':
                                output += `${chalk.blue('Pull Request Review Comment URL:')} ${chalk.underline.blue(event.payload.comment.html_url)}`;
                                break;
                            case 'PullRequestReviewThreadEvent':
                                output += `${chalk.blue('Pull Request Review Thread URL:')} ${chalk.underline.blue(event.payload.thread.html_url)}`;
                                break;
                            case 'PushEvent':
                                // Assuming the first commit in the payload
                                if (event.payload.commits.length > 0) {
                                    output += `${chalk.blue('Commit URL:')} ${chalk.underline.blue(event.payload.commits[0].url)} ${event.payload.commits[0].message.split('\n').join(' \ ')}`;
                                    if (lat && long && OPENAI_FEATURE_FLAG_GENERATE_COMMENTS) {
                                        generatedComment = await handlePushEvent(event, userProfile.data.location)
                                    }
                                }
                                break;
                            case 'ReleaseEvent':
                                output += `${chalk.blue('Release URL:')} ${chalk.underline.blue(event.payload.release.html_url)}`;
                                break;
                            case 'SponsorshipEvent':
                                output += `${chalk.blue('Sponsorship URL:')} ${chalk.underline.blue(event.payload.sponsorship.html_url)}`;
                                break;
                            case 'WatchEvent':
                                output += `${chalk.blue('Repository URL:')} ${chalk.underline.blue(event.repo.url)}`;
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
                                    uml: userProfile.data.location,
                                    gm: { lat, lon: long },
                                    uol: userProfile.data.location,
                                    gop: { lat: 33.58535236663171, lon: -7.631805876712778 },
                                    l: "WHO CARES", // repo dominant language?
                                    a: event.actor.login,
                                    nwo: event.repo.name,
                                    pr: 0, // pr number for link reconstruction?
                                    ma: event.created_at,
                                    oa: new Date().toISOString(), // "We delay the public events feed by five minutes, which means the most recent event returned by the public events API actually occurred at least five minutes ago."
                                    tg: generatedComment,
                                    dce: commentResponse && commentResponse.data ? `https://api.github.com/repos/${event.repo.name}/comments/` + commentResponse.data.id : commentResponse
                                }
                            } else {
                                dataEntry = {
                                    uml: userProfile.data.location,
                                    gm: { lat, lon: long },
                                    uol: userProfile.data.location,
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

                            const dataFilePath = path.join('./globe/bin/webgl-globe/data/data.json');
                            let existingData = [];
                            existingData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
                            if (dataEntry)
                                existingData.push(dataEntry);
                            if (strikeEntry)
                                existingData.push(strikeEntry);
                            fs.writeFileSync(dataFilePath, JSON.stringify(existingData, null, 2));
                        }

                        logGitHub(util.inspect(event, { depth: null, colors: true }));
                    }, i * 1000); // Display each event with a 1-second delay
                }
            }
        }
        setTimeout(fetchEvents, pollingInterval);
    } catch (error) {
        if (error.status === 304) {
            console.log('No new events');
        } else if (error.response.headers['x-ratelimit-remaining'] === '0') {
            const resetTime = parseInt(error.response.headers['x-ratelimit-reset']) * 1000;
            const now = Date.now();
            const delay = Math.max(resetTime - now, 0); // Ensure non-negative delay
            console.log(`Rate limit exceeded. Waiting for ${delay / 1000} seconds before retrying.`);
            setTimeout(fetchEvents, delay);
        } else {
            console.error('Unhandled error:', error);
            setTimeout(() => {
                process.exit();
            }, GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY)
        }
    }
}

async function handlePushEvent(event, location) {
    let generatedComment;
    const commitUrl = event.payload.commits[0].url;
    if (stopProcessingEvents) return ;

    const response = await axios.get(commitUrl, {
        headers: { "Authorization": "Bearer " + githubKey }
    })
    if (response.status !== 200) return ;
    if (stopProcessingEvents) return ;

    const files = response.data.files

    // Génère un commentaire avec l'API d'OpenAI
    const openaiApiKey = openaiKey;
    const openaiEndpoint = 'https://api.openai.com/v1/chat/completions';

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
    if (stopProcessingEvents) return ;

    const openaiResponse = await axios.post(openaiEndpoint, {
        model: "gpt-4o",
        messages: [
            {
                role: "system",
                content: PROMPT_WRAPPER(
                PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
                files
                ),
            }
        ],
    }, {
        headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${openaiApiKey}`
        }
    })
    if (stopProcessingEvents) return ;

    generatedComment = openaiResponse.data.choices[0].message.content;

    // Publie le commentaire généré sur le commit
    try {
        if (GITHUB_FEATURE_FLAG_POST_COMMENTS) {
            if (stopProcessingEvents) return ;

            const commentEndpoint = `https://api.github.com/repos/${event.repo.name}/commits/${event.payload.commits[0].sha}/comments`;
            commentResponse = await axios.post(commentEndpoint, {
                body: generatedComment,
            }, {
                headers: {
                    "Accept": "application/vnd.github+json",
                    'Authorization': `Bearer ${githubKey}`,
                    "X-GitHub-Api-Version": "2022-11-28"
                }
            })
            if (commentResponse.status !== 201) {
                throw commentResponse
            }
            if (commentResponse.status === 201 && GITHUB_FEATURE_FLAG_DELETE_COMMENTS) {
                setTimeout(async () => {
                    try {
                        const deleteCommentEndpoint = `https://api.github.com/repos/${event.repo.name}/comments/` + commentResponse.data.id;
                        await axios.delete(deleteCommentEndpoint, {
                            headers: {
                                "Accept": "application/vnd.github+json",
                                'Authorization': `Bearer ${githubKey}`,
                                "X-GitHub-Api-Version": "2022-11-28"
                            }
                        })
                    } catch (e) {
                        console.log('gneeeeeeeeeeeeeeeeeeeeeeeeee')
                    }
                }, GITHUB_DELETE_COMMENTS_DELAY)
            }
        }
    } catch (e) {
        console.log('Error posting/deleting comment:', e)
    }

    return generatedComment;
}

fetchEvents();

process.on('SIGINT', function () {
    const exitDelay = GITHUB_FEATURE_FLAG_POST_COMMENTS ? GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY : 0;
    console.log(`Caught interrupt signal. Exiting in ${exitDelay / 1000}s...`);
    stopProcessingEvents = true;
    setTimeout(() => {
        process.exit();
    }, exitDelay)
});