# LazyBackup - VPS Backup Manager

LazyBackup is a web-based application for managing backups of your VPS servers. It allows you to configure and schedule backups using SSH and Rsync, and provides a dashboard to monitor the status of your backups.

## Features

- **Server Management**: Add, edit, and delete VPS server connections with SSH authentication
- **Backup Configuration**: Configure backup sources, destinations, schedules, and exclusion patterns
- **Automated Backups**: Schedule backups using cron expressions
- **Backup History**: View the history and status of all backup operations
- **Dashboard**: Get an overview of your backup infrastructure at a glance

## Tech Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: SQLite with Drizzle ORM
- **Authentication**: SSH for server connections
- **Backup**: Rsync for efficient file transfers
- **Scheduling**: Cron for scheduling backups

## Getting Started

### Prerequisites

- Node.js 18+ or Bun 1.0+
- A VPS server with SSH access

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/lazybackup.git
   cd lazybackup
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set up the database:
   ```bash
   bun run db:generate
   bun run db:migrate
   ```

4. Start the development server:
   ```bash
   bun run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Add a Server**: Navigate to the Servers page and add your VPS server details.
2. **Configure Backups**: Create backup configurations for your servers.
3. **Monitor Backups**: View the status of your backups on the Dashboard or History page.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [Next.js](https://nextjs.org/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
