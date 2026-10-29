# AquaSense Database Setup Guide

## Prerequisites
- PostgreSQL 12+ must be installed and running

## Setup Instructions

### Option 1: Using PostgreSQL Command Line (Windows)

1. Open Command Prompt or PowerShell

2. Connect to PostgreSQL as the superuser:
   ```cmd
   psql -U postgres
   ```
   
3. When prompted for password, enter your PostgreSQL password

4. Create the AquaSense database:
   ```sql
   CREATE DATABASE "AquaSense";
   ```

5. Verify the database was created:
   ```sql
   \l
   ```

6. Exit psql:
   ```sql
   \q
   ```

### Option 2: Using pgAdmin (GUI)

1. Open pgAdmin
2. Right-click on "Databases" and select "Create" > "Database"
3. Name: AquaSense
4. Click "Save"

## Environment Variables Configuration

Update the `.env` file in the Backend folder with your PostgreSQL credentials:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=AquaSense
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_DIALECT=postgres
```

## Verify Connection

After creating the database, run:

```bash
cd Backend
npm run dev
```

You should see:
```
✓ Database connected: AquaSense on localhost:5432
✓ Database models synchronized
✓ Server is running on http://localhost:5000
```

## Database Tables

The system will automatically create these tables:
- `users` - Stores user accounts with bcrypt-hashed passwords
- `sensor_readings` - Stores all sensor measurements (temperature, pH, DO, turbidity)

## Initial Data

When the application starts:
1. PostgreSQL authenticates your user
2. Tables are created if they don't exist
3. The backend is ready to receive data

## Troubleshooting

### "password authentication failed for user postgres"
- PostgreSQL is installed but wrong password in .env
- Check your PostgreSQL password and update DB_PASSWORD in .env
- Or reset PostgreSQL password:
  ```
  ALTER USER postgres WITH PASSWORD 'new_password';
  ```

### "could not connect to server"
- PostgreSQL service is not running
- Start PostgreSQL service:
  - Windows: Services > PostgreSQL > Start
  - Or: ```
    net start PostgreSQL-x64-XX
    ```
    (Replace XX with your PostgreSQL version)

### "database does not exist"
- Run the CREATE DATABASE command above
- Or create via pgAdmin GUI
