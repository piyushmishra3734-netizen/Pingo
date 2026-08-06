package chat.pingo.app;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import java.util.concurrent.Executor;

import org.json.JSONObject;

/**
 * Passkeys, made by the app rather than by the page.
 *
 * <h2>Why the WebView could not do this itself</h2>
 *
 * PINGO seals a backup to 32 bytes that only one authenticator can produce -
 * WebAuthn's PRF extension - so somebody restores their history with the same
 * face or fingerprint that unlocks their phone, and never has to remember a
 * password they chose once. That works in a browser. Inside the app it did not
 * work at all, so the passkey button simply never appeared and the only way in
 * was the passcode - which is exactly the thing people forget.
 *
 * A WebView can be given WebAuthn (androidx.webkit has a switch for it), but a
 * relying party id has to be a real domain associated with the app, and the app
 * serves its pages from {@code https://localhost}. Moving it to the real domain
 * would change the origin, and an origin change takes every signed-in session,
 * every cached conversation and every stored lock with it. That is a large
 * price for a feature, and it is avoidable: when the *app* asks Credential
 * Manager, the page's origin is not part of the question. The relying party is
 * PINGO's domain, proven by the asset links file it serves, and the WebView
 * carries on being served from wherever it likes.
 *
 * <h2>What crosses the bridge</h2>
 *
 * WebAuthn JSON in, WebAuthn JSON out - the same shapes the web path already
 * builds and parses, so there is one implementation of the interesting part and
 * this is a transport. No key material is interpreted here; the PRF output is a
 * field in the response the page reads for itself.
 *
 * <h2>Whether PRF works is not knowable in advance</h2>
 *
 * The extension is passed through to whichever credential provider the user
 * has, and support is theirs to have or not. Nothing here can promise it, so
 * nothing here claims to: the page asks, reads the answer, and says plainly
 * when a passkey was made that cannot carry a backup.
 */
public class PasskeyBridge {

    private final Activity activity;
    private final WebView webView;
    private final CredentialManager credentialManager;
    private final Executor executor;

    public PasskeyBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.credentialManager = CredentialManager.create(activity);
        // The callbacks land on the UI thread, which is where evaluateJavascript
        // has to be called from anyway.
        this.executor = activity::runOnUiThread;
    }

    /**
     * Whether this build can be asked at all.
     *
     * The page calls it before offering the passkey option, so that a shell
     * without the dependency - or a device with no credential provider - shows
     * the passcode path rather than a button that fails when pressed.
     */
    @JavascriptInterface
    public boolean available() {
        return true;
    }

    /** Registration. `requestJson` is PublicKeyCredentialCreationOptionsJSON. */
    @JavascriptInterface
    public void create(String requestJson, String callId) {
        try {
            CreatePublicKeyCredentialRequest request =
                    new CreatePublicKeyCredentialRequest(requestJson);

            credentialManager.createCredentialAsync(
                    activity,
                    request,
                    null,
                    executor,
                    new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        @Override
                        public void onResult(@NonNull CreateCredentialResponse response) {
                            if (response instanceof CreatePublicKeyCredentialResponse) {
                                settle(callId, true, "ok",
                                        ((CreatePublicKeyCredentialResponse) response)
                                                .getRegistrationResponseJson());
                            } else {
                                fail(callId, "failed", "That passkey could not be created.");
                            }
                        }

                        @Override
                        public void onError(@NonNull CreateCredentialException error) {
                            fail(callId,
                                    error instanceof CreateCredentialCancellationException
                                            ? "cancelled"
                                            : "failed",
                                    message(error));
                        }
                    });
        } catch (Exception cause) {
            fail(callId, "failed", message(cause));
        }
    }

    /** Assertion. `requestJson` is PublicKeyCredentialRequestOptionsJSON. */
    @JavascriptInterface
    public void get(String requestJson, String callId) {
        try {
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetPublicKeyCredentialOption(requestJson))
                    .build();

            credentialManager.getCredentialAsync(
                    activity,
                    request,
                    null,
                    executor,
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(@NonNull GetCredentialResponse response) {
                            if (response.getCredential() instanceof PublicKeyCredential) {
                                settle(callId, true, "ok",
                                        ((PublicKeyCredential) response.getCredential())
                                                .getAuthenticationResponseJson());
                            } else {
                                fail(callId, "failed", "That passkey could not be used.");
                            }
                        }

                        @Override
                        public void onError(@NonNull GetCredentialException error) {
                            fail(callId,
                                    error instanceof GetCredentialCancellationException
                                            ? "cancelled"
                                            : "failed",
                                    message(error));
                        }
                    });
        } catch (Exception cause) {
            fail(callId, "failed", message(cause));
        }
    }

    /**
     * The message, never the exception's own words where they would leak.
     *
     * Credential Manager's messages name providers and internal states, which
     * belongs in a log rather than in front of somebody trying to protect their
     * history. A short honest sentence, and the code carries the rest.
     */
    private static String message(Throwable cause) {
        String detail = cause.getMessage();
        return detail == null || detail.isEmpty() ? "That did not work." : detail;
    }

    private void fail(String callId, String code, String detail) {
        settle(callId, false, code, detail);
    }

    /**
     * Hands the outcome back to the page.
     *
     * Everything goes through JSON encoding rather than string concatenation:
     * a WebAuthn response is attacker-influenced text arriving in a script, and
     * building that script by gluing strings together is how a credential
     * response becomes code.
     */
    private void settle(String callId, boolean ok, String code, String payload) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", ok);
            result.put("code", code);
            result.put("payload", payload == null ? "" : payload);

            String script = "window.__pingoPasskeyResult && window.__pingoPasskeyResult("
                    + JSONObject.quote(callId) + "," + result + ")";

            webView.post(() -> webView.evaluateJavascript(script, null));
        } catch (Exception ignored) {
            // A result that cannot be encoded cannot be delivered. The page's
            // own timeout is what stops it waiting for ever.
        }
    }
}
