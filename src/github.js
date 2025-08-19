import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";
import { _fetch, rainbow } from "./utils.js";
import { generateComment } from "./ai.js";
import { getLocation } from "./location.js";
import fs from "fs";
import path from "path";
import { styleText } from "util";

const GITHUB_EVENTS_PER_PAGE = 100;
const GROSSO_MERDO = 5000;
const FEATURE_FLAG_GENERATE_COMMENTS = true;
const GITHUB_FEATURE_FLAG_POST_COMMENTS = false;
const GITHUB_FEATURE_FLAG_DELETE_COMMENTS = true;
const GITHUB_DELETE_COMMENTS_DELAY = 60 * 1000;
const GITHUB_DELETE_COMMENTS_DELAY_WITH_LATENCY = GITHUB_DELETE_COMMENTS_DELAY + (GITHUB_EVENTS_PER_PAGE * 1000) + GROSSO_MERDO;

let etag = null;
let lastModified = null;
let pollingInterval = 0;
let stopProcessingEvents = false;
let hasPostedComments = false;

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
    auth: process.env.GITHUB_KEY,
})

export async function fetchEvents(userLocation) {
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
                                    'Authorization': `Bearer ${process.env.GITHUB_KEY}`,
                                    'X-GitHub-Api-Version': '2022-11-28'
                                }
                            });
                            if (stopProcessingEvents) return;
                            let output = '', generatedComment = '';
                            let res, lat, long, handlingResult

                            try {
                                if (user && user.location) {
                                    if (stopProcessingEvents) return;
                                    const location = await getLocation(user.location);
                                    if (stopProcessingEvents) return;
                                    if (location) {
                                        const { lat: latitude, lon: longitude } = location;
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
                                        output += `${styleText('blue', 'Commit URL:')} ${styleText(['underline', 'blue'], event.payload.commits[0].url)} ${event.payload.commits[0].message?.split('\n').join(' \ ')}`;
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

                            if (event.type === 'PushEvent')
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
        setTimeout(() => fetchEvents(userLocation), pollingInterval);
    } catch (error) {
        handleError(error)
    }
}

export async function handlePushEvent(event, location) {
    let generatedComment;
    const { url } = event.payload.commits[0];
    if (stopProcessingEvents) return;

    const { files } = await (await _fetch(url, {
        headers: { "Authorization": "Bearer " + process.env.GITHUB_KEY }
    })).json();

    if (stopProcessingEvents) return;

    generatedComment = await generateComment(files, location);

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
                'Authorization': `Bearer ${process.env.GITHUB_KEY}`,
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
                            'Authorization': `Bearer ${process.env.GITHUB_KEY}`,
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

export function stopProcessing() {
    stopProcessingEvents = true;
}

export function hasPosted() {
    return hasPostedComments;
}
