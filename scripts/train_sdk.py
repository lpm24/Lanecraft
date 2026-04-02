"""
Start LoRA training using the Replicate Python SDK.
Run after: python scripts/train_lora.py prep

Usage:
  python scripts/train_sdk.py train
  python scripts/train_sdk.py status
"""

import os
import sys
import json

try:
    import replicate
except ImportError:
    print("ERROR: Run: pip install replicate")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ZIP_PATH = os.path.join(SCRIPT_DIR, "lora_training_data.zip")
STATE_FILE = os.path.join(SCRIPT_DIR, "lora_state.json")
TRIGGER_WORD = "LCBLDG"


def cmd_train():
    if not os.path.exists(ZIP_PATH):
        print("ERROR: No training zip. Run: python scripts/train_lora.py prep")
        sys.exit(1)

    # Get the user's Replicate username
    print("Getting account info...")
    try:
        client = replicate.Client()
        resp = client._request("GET", "/v1/account")
        username = resp.json()["username"]
        print(f"  Username: {username}")
    except Exception as e:
        print(f"  Could not get username: {e}")
        username = sys.argv[2] if len(sys.argv) > 2 else "kingkrool"
        print(f"  Using: {username}")

    destination = f"{username}/lanecraft-buildings"
    print(f"  Destination model: {destination}")

    # Create the destination model if it doesn't exist
    print("\nCreating destination model...")
    try:
        replicate.models.create(
            owner=username,
            name="lanecraft-buildings",
            visibility="private",
            hardware="gpu-t4",
            description="LoRA fine-tuned on Lanecraft RTS building sprites",
        )
        print("  Model created.")
    except Exception as e:
        if "already exists" in str(e).lower():
            print("  Model already exists, reusing.")
        else:
            print(f"  Note: {e}")

    # Start training
    print("\nUploading training data and starting training...")
    print(f"  Zip: {ZIP_PATH} ({os.path.getsize(ZIP_PATH) / 1024 / 1024:.1f} MB)")

    with open(ZIP_PATH, "rb") as f:
        training = replicate.trainings.create(
            model="ostris/flux-dev-lora-trainer",
            version="26dce37af90b9d997eeb970d92e47de3064d46c300504ae376c75bef6a9022d2",
            destination=destination,
            input={
                "input_images": f,
                "trigger_word": TRIGGER_WORD,
                "steps": 1200,
                "learning_rate": 0.0001,
                "lora_rank": 16,
                "batch_size": 1,
                "resolution": "512,768,1024",
                "autocaption": False,
            },
        )

    print(f"\n  Training started!")
    print(f"  ID: {training.id}")
    print(f"  Status: {training.status}")

    # Save state
    state = {
        "training_id": training.id,
        "status": training.status,
        "destination": destination,
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

    print(f"\n  State saved to: {STATE_FILE}")
    print(f"  Check progress: python scripts/train_sdk.py status")
    print(f"  Or visit: https://replicate.com/p/{training.id}")


def cmd_status():
    if not os.path.exists(STATE_FILE):
        print("No training in progress.")
        return

    with open(STATE_FILE) as f:
        state = json.load(f)

    training_id = state["training_id"]
    print(f"Training ID: {training_id}")

    training = replicate.trainings.get(training_id)
    print(f"Status: {training.status}")

    if training.status == "succeeded":
        print(f"\nTraining complete!")
        print(f"Model: {state.get('destination', 'unknown')}")
        output = training.output
        print(f"Output: {output}")

        state["status"] = "succeeded"
        state["model_output"] = str(output) if output else state.get("destination")
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)

        print(f"\nReady to generate! Run: python scripts/train_lora.py generate")

    elif training.status == "failed":
        print(f"\nFailed: {training.error}")
        if training.logs:
            print(f"\nLogs (last 500 chars):\n{training.logs[-500:]}")

    elif training.status == "processing":
        if training.logs:
            lines = training.logs.strip().split("\n")
            print(f"\nRecent logs:")
            for line in lines[-15:]:
                print(f"  {line}")
        else:
            print("  Processing (no logs yet)...")

    else:
        print(f"  Waiting to start...")


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/train_sdk.py [train|status]")
        return

    cmd = sys.argv[1].lower()
    if cmd == "train":
        cmd_train()
    elif cmd == "status":
        cmd_status()
    else:
        print(f"Unknown: {cmd}")


if __name__ == "__main__":
    main()
