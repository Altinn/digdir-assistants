# Assistants-Admin

Assistants-Admin is a sophisticated web application designed to display real-time chat data. Utilizing a modern tech stack including React, TypeScript, Supabase, Slack for authentication, and the react-admin package, it offers a comprehensive platform for organizing and viewing chat messages in real-time. The application emphasizes organization, accessibility, and ease of navigation, catering to a seamless user experience.

## Overview

The project architecture includes:
- **Frontend:** Built with React and TypeScript, leveraging react-admin for a powerful UI experience.
- **Backend:** Supabase serves as the backend and real-time database, integrated with Slack for authentication.
- **Authentication:** Supports Slack OAuth, with additional email authentication provided by Supabase.

Messages are organized by teams and channels, with a dedicated pane for threaded replies, offering a structured and intuitive chat interface.

## Features

- **User Authentication:** Secure login via Slack credentials or email.
- **Real-time Chat Display:** Messages and threads update dynamically without the need for page refreshes.
- **Dynamic UI Components:** The UI dynamically updates to reflect the latest chat data, thanks to react-admin and Supabase's real-time capabilities.
- **Threaded Replies:** Threaded replies are supported for detailed discussions within the chat.

## Getting started

### Requirements

- Node.js installed on your computer.
- A Slack account and a Supabase project set up for backend services and authentication.

### Quickstart

1. Clone the repository.
2. Install dependencies with `npm install`.
3. Set up `.env` file with Supabase URL and Anon Key.
4. Run `npm run dev` to start the development server. The app will be accessible at `http://localhost:3000`.

### License

Copyright (c) 2024.