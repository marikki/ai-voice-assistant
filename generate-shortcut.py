import plistlib
import uuid
import os

# Read secrets/config from the environment so they are never committed.
#   SHORTCUT_TOKEN  — must match the value in the server's .env
#   APP_URL         — base URL where the app is hosted
TOKEN = os.environ.get("SHORTCUT_TOKEN", "YOUR_SHORTCUT_TOKEN")
API_URL = os.environ.get("APP_URL", "http://localhost:3000") + "/api/shortcut"

# UUIDs for action outputs (so later actions can reference them)
UUID_DICTATE = str(uuid.uuid4()).upper()
UUID_REQUEST = str(uuid.uuid4()).upper()
UUID_DICT_VAL = str(uuid.uuid4()).upper()

def text_token(s):
    """A static text value."""
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

def var_token(output_name, output_uuid):
    """A reference to the output of a previous action (Magic Variable)."""
    return {
        "Value": {
            "attachmentsByRange": {
                "{0, 1}": {
                    "OutputName": output_name,
                    "OutputUUID": output_uuid,
                    "Type": "ActionOutput",
                }
            },
            "string": "￼",  # Unicode object replacement char — placeholder
        },
        "WFSerializationType": "WFTextTokenString",
    }

def dict_field(key_str, value_token):
    return {
        "WFItemType": 0,
        "WFKey": text_token(key_str),
        "WFValue": value_token,
    }

shortcut = {
    "WFWorkflowClientVersion": "1300.0.0",
    "WFWorkflowHasShortcutInputVariables": False,
    "WFWorkflowImportQuestions": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowName": "VoiceMind",
    "WFWorkflowTypes": [],
    "WFWorkflowActions": [
        # 1. Dictate Text — iOS speech recognition → returns plain text
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.dictatetext",
            "WFWorkflowActionParameters": {
                "UUID": UUID_DICTATE,
                "CustomOutputName": "Dictated Text",
                "WFSpeakTextLanguage": "uk-UA",
                # Keep listening through natural pauses — recording ends only when
                # the user taps "Done", instead of auto-stopping on the first silence.
                "WFDictateTextActionStopListeningWhenSilent": False,
            },
        },
        # 2. POST text to VoiceMind API
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": UUID_REQUEST,
                "CustomOutputName": "API Response",
                "WFHTTPMethod": "POST",
                "WFURL": API_URL,
                "WFHTTPBodyType": "JSON",
                "WFHTTPHeaders": {
                    "Value": {
                        "WFDictionaryFieldValueItems": [
                            dict_field("Authorization", text_token(f"Bearer {TOKEN}")),
                            dict_field("Content-Type", text_token("application/json")),
                        ]
                    },
                    "WFSerializationType": "WFDictionaryFieldValue",
                },
                "WFFormValues": {
                    "Value": {
                        "WFDictionaryFieldValueItems": [
                            dict_field("text", var_token("Dictated Text", UUID_DICTATE)),
                            dict_field("language", text_token("uk")),
                        ]
                    },
                    "WFSerializationType": "WFDictionaryFieldValue",
                },
            },
        },
        # 3. Extract "title" from JSON response
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": UUID_DICT_VAL,
                "CustomOutputName": "Title",
                "WFDictionaryKey": text_token("title"),
                "WFInput": var_token("API Response", UUID_REQUEST),
            },
        },
        # 4. Show notification with the AI-generated title
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
            "WFWorkflowActionParameters": {
                "WFNotificationActionTitle": text_token("VoiceMind AI"),
                "WFNotificationActionBody": var_token("Title", UUID_DICT_VAL),
                "WFNotificationActionPlaySound": True,
            },
        },
    ],
}

out_path = os.path.join(os.path.dirname(__file__), "public", "VoiceMind.shortcut")
os.makedirs(os.path.dirname(out_path), exist_ok=True)

with open(out_path, "wb") as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)

print(f"✓ {out_path} ({os.path.getsize(out_path)} bytes)")
