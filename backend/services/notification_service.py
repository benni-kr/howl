import os
import json
import urllib.request
import ssl
from models import Issue

def send_discord_notification(issue: Issue):
    """
    Sends a Discord webhook notification when a new issue is created.
    Uses the DISCORD_WEBHOOK_URL environment variable.
    """
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        return
        
    try:
        # 16711680 = Red (for bugs), 5814783 = Blue (for everything else)
        color = 16711680 if issue.type == "bug" else 5814783
        
        data = {
            "embeds": [
                {
                    "title": f"New Issue Reported: {issue.type}",
                    "description": issue.description,
                    "color": color,
                    "fields": [
                        {
                            "name": "Reporter", 
                            "value": issue.created_by or "Anonymous", 
                            "inline": True
                        },
                        {
                            "name": "Influenced Runs", 
                            "value": issue.influenced_runs or "None", 
                            "inline": True
                        }
                    ]
                }
            ]
        }
        
        req = urllib.request.Request(
            webhook_url, 
            data=json.dumps(data).encode('utf-8'), 
            headers={
                'Content-Type': 'application/json', 
                'User-Agent': 'HowlBot'
            }
        )
        
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        urllib.request.urlopen(req, timeout=5, context=ctx)
    except Exception as e:
        print(f"Failed to send Discord webhook: {e}")
