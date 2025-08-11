


https://github.com/user-attachments/assets/d7ad7050-e758-4a47-876c-36d81d4237d3


> *Just published my new project for everybody looking for a "remote" job, lol. It uses GitHub Events API and [@bryan_houlton](https://github.com/bryanhoulton/senior-dev)'s prompts.*

*Shamelessly plug your resume using `RESUME_URL`.*

[![As seen on Hacker News](https://img.shields.io/hackernews/user-karma/_u0u9)](https://news.ycombinator.com/item?id=41032514)

# Prerequistes

You will need Node v23.9.0.  
You will also need a [GitHub](https://github.com/settings/tokens) _(public_repo)_ and a [LocationIQ](https://my.locationiq.com/dashboard/#accesstoken) API key.  
Optionally, you can use an [OpenAI](https://platform.openai.com/api-keys) API key instead of [Ollama](https://github.com/ollama/ollama).

# Install

```
$ git clone git@github.com:rhnaxifg4y/github-stream.git --recursive && cd ./github-stream
$ cd ./globe && git checkout main && git pull && cd -
$ npm install
$ cp .env.example .env
$ curl -fsSL https://ollama.com/install.sh | sh
$ ollama pull llama3
$ curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

# Usage

```
$ ollama serve &
$ npm start
```

Or run the GitHub Actions workflow locally using [act-cli](https://github.com/nektos/act):

```
$ act -P ubuntu-latest=catthehacker/ubuntu:act-latest -b workflow_dispatch
```

## Add-on

Visualize data on the globe:

```
$ cd ./globe
$ npm install
$ npm run dev
```

Visit http://localhost:8080.
