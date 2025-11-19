
# Backing up PocketBase

It is recommended to back your pocketbase up to be able to recover it (in case of data loss)

## How to Create a Backup

To back your database up, follow these steps:


1. **Open the PocketBase Admin Dashboard**  
   Visit `http://<server-ip>:8092/_` and sign in using the credentials you configured through the `PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD` environment variables.

2. **Navigate to the Backup Section**  
   In the left sidebar, click the **Tools** icon (to go to settings), then select **Backups**.

3. **Initialize a New Backup**  
   Click **Initialize new backup**.  
   You may enter a custom name, or leave it blank to let PocketBase auto-generate one.

4. **Optional, but recommended: Download the Backup File**  
   After the backup appears in the list, hover over it and click **Download** to save it locally.
