import axios from 'axios';
import path from 'path';
import fs from 'fs';

var githubKeyForComments = ''; // public repositories scope

const dataFilePath = path.join('./globe/data.json');

// Read existing data from data.json
let existingData = [];
existingData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
existingData.reverse();

(async () => {
    for (let i = 0; i < existingData.length; i++) {
        console.log(`${i}/${existingData.length}`)
        if (existingData[i].dce) {
            try {
                const deleteCommentEndpoint = existingData[i].dce
                await axios.delete(deleteCommentEndpoint, {
                    headers: {
                        "Accept": "application/vnd.github+json",
                        'Authorization': `Bearer ${githubKeyForComments}`,
                        "X-GitHub-Api-Version": "2022-11-28"
                    }
                })
            } catch (e) {
                if (e.response.status != 404) {
                    console.log(e.response)
                    process.exit()
                }
            }
        }
    }
})()