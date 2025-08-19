import { _fetch } from "./utils.js";
import { getRandom } from "./utils.js";

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

const PROMPT_WRAPPER = (prompt, files, location) => `
${prompt}

You can't be too rude because your boss is watching, but be as unhelpful as possible and
as rude as you can get away with.

Here are the diffs for the commit:‎ ‎
${JSON.stringify(files)}

Answer using a sentance in the local language for the following location: "${location}".

Make a reference to the code pushed in the comment when possible/appropriate.
`;

export async function generateComment(files, location) {
    let openaiKeys = process.env.OPENAI_KEYS ? process.env.OPENAI_KEYS.split(',').filter(Boolean) : [];
    let openaiKey = getRandom(openaiKeys);

    const chatbots = []
    if (openaiKeys.length) chatbots.push({ endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' }); // https://platform.openai.com/docs/guides/text-generation/chat-completions-api
    chatbots.push({ endpoint: 'http://127.0.0.1:11434/api/chat', model: 'llama3', keep_alive: -1 });
    const chatbot = getRandom(chatbots);

    const data = await (await _fetch(chatbot.endpoint, {
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
                        files,
                        location
                    ),
                }
            ],
            stream: false
        })
    })).json();

    return data.choices ? data.choices[0].message.content : data.message.content;
}
