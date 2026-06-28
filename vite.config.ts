services:
  - type: web
    name: davomat-maosh-bot
    runtime: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      # DATA_DIR: point to a Render Disk mount path if you add persistent storage.
      # Without a disk, db.json lives in the deploy and resets on each deploy.
      # Recommended: add a Render Disk mounted at /data and set DATA_DIR=/data
      - key: DATA_DIR
        value: /data
    # Uncomment the disk block below after adding a "Disk" to your service in
    # the Render dashboard (Free plan does not include disks):
    # disk:
    #   name: bot-data
    #   mountPath: /data
    #   sizeGB: 1
