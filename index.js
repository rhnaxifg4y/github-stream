import util from "util";
import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";
import NodeGeocoder from 'node-geocoder';
import chalk from "chalk";
import chalkRainbow from 'chalk-rainbow';
import debug from "debug";
import path from "path";
import fs from "fs";

const log = debug('github:events');

const logHandler =  (e, d) => {
    process.nextTick();
}

const githubKeys = [
    
]

var githubKey = githubKeys[Math.floor(Math.random() * githubKeys.length)];

Octokit.plugin(throttling);

const octokit = new Octokit({
    log: {
        debug: logHandler,
        info: logHandler,
        warn: logHandler,
        error: logHandler,
    },
    auth: githubKey,
})

let etag = null;
let lastModified = null;
let pollingInterval = 5000; // 5 seconds

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

            const events = response.data;
            for (let i = 0; i < events.length; i++) {
                setTimeout(async () => {
                    const event = events[i];

                    const userProfile = await octokit.request('GET /users/{username}', {
                        username: event.actor.login,
                        headers: {
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    });

                    let output = '';
                    let res, lat, long
                    try {
                        if (userProfile.data && userProfile.data.location) {
                            const geocoder = NodeGeocoder({ provider: 'locationiq', apiKey: 'pk.174e20d415e9a6d60a9ec294df228c85' });
                            res = await geocoder.geocode(userProfile.data.location);
                            log('HALOOOO', userProfile.data.location, res[0])
                            if (res && res.length) {
                                const { latitude, longitude } = res[0];
                                lat = latitude
                                long = longitude
                                output += `${chalkRainbow(`(${latitude}, ${longitude})`)} `;
                            }
                        } else {
                            output += `:'( `
                        }
                    } catch (e) {
                        output += 'x| '
                        console.log(res, e)
                        // process.exit();
                    }

                    output += `${chalk.blue('ID:')} ${chalk.green(event.id)} ` +
                                   `${chalk.blue('Created at:')} ${chalk.green(event.created_at)} ` +
                                   `${chalk.blue('Type:')} ${chalk.green(event.type)} ` +
                                   `${chalk.blue('Actor:')} ${chalk.green(event.actor.login)} ` +
                                   `${chalk.blue('Repo:')} ${chalk.green(event.repo.name)} `;

                    // Add clickable link based on event type
                    switch (event.type) {
                        case 'CommitCommentEvent':
                            output += `${chalk.blue('Comment URL:')} ${chalk.underline.blue(event.payload.comment.html_url)} ${event.payload.comment}`;
                            break;
                        case 'CreateEvent':
                            // Depending on what you want to link (e.g., repository, branch)
                            output += `${chalk.blue('Create URL:')} ${chalk.underline.blue(event.repo.url)} (${event.payload.ref})`;
                            break;
                        case 'DeleteEvent':
                            // Depending on what you want to link (e.g., repository, branch)
                            output += `${chalk.blue('Repository URL:')} ${chalk.underline.blue(event.repo.url)} (${event.payload.ref})`;
                            break;
                        case 'ForkEvent':
                            output += `${chalk.blue('Fork URL:')} ${chalk.underline.blue(event.payload.forkee.html_url)}`;
                            break;
                        case 'GollumEvent':
                            // Handle wiki page URLs
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

                    if (lat && long) {
                        const dataEntry = {
                            uml: userProfile.data.location,
                            gm: { lat, lon: long }, // geo_user_merged
                            uol: userProfile.data.location,
                            gop: { lat, lon: long }, // geo_user_opened
                            l: "WHO CARES", // repo dominant language?
                            a: event.actor.login,
                            nwo: event.repo.name,
                            pr: 0, // pr number for link reconstruction?
                            ma: event.created_at, // double check
                            oa: new Date().toISOString() // double check
                        }

                        const dataFilePath = path.join('./globe/bin/webgl-globe/data/data.json');

                        // Read existing data from data.json
                        let existingData = [];
                        try {
                            existingData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
                        } catch (error) {
                            console.error('Error reading data.json:', error);
                        }
                        
                        // Append new entry to the existing array
                        existingData.push(dataEntry);
                        
                        // Write updated data back to data.json
                        try {
                            fs.writeFileSync(dataFilePath, JSON.stringify(existingData, null, 2));
                        } catch (error) {
                            console.error('Error writing to data.json:', error);
                        }

                    }

                    log(util.inspect(event, { depth: null, colors: true }));
                }, i * 1000); // Display each event with a 1-second delay
            }
        }
    } catch (error) {
        if (error.status === 304) {
            console.log('No new events');
        } else {
            console.error('Error fetching events:', error.response);
            if (error.response.headers['x-ratelimit-remaining'] === '0')
                process.exit()
        }
    } finally {
        setTimeout(fetchEvents, pollingInterval);
    } 
}

fetchEvents();