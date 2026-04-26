const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const buildEmailHtml = (otp, purpose) => {
  const heading =
    purpose === "reset" ? "Reset your password" : "Verify your account";
  const subheading =
    purpose === "reset"
      ? "We received a request to reset your NairaT password. Use the code below to continue."
      : "Almost there. Enter this code in the NairaT app to confirm your account.";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NairaT</title>
</head>
<body style="margin:0;padding:0;background:#FBF8F3;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;color:#1A1209;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF8F3;">
    <tr>
      <td align="center" style="padding:48px 20px;">

        <!-- CARD -->
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #E8DFD3;box-shadow:0 8px 24px rgba(93,64,55,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#5D4037 0%,#3E2723 60%,rgba(184,115,51,0.6) 100%);padding:40px 32px;text-align:center;">
              <table align="center" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#B87333;border-radius:10px;width:44px;height:44px;text-align:center;vertical-align:middle;">
                    <span style="color:white;font-size:22px;font-weight:700;line-height:44px;">₦</span>
                  </td>
                  <td style="padding-left:12px;">
                    <span style="color:white;font-size:24px;font-weight:600;letter-spacing:-0.3px;">Naira<span style="color:#E8A87C;font-weight:700;">T</span></span>
                  </td>
                </tr>
              </table>
              <p style="color:rgba(255,255,255,0.75);font-size:11px;font-weight:500;letter-spacing:2.5px;margin:18px 0 0;">PROGRAMMABLE MONEY</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:48px 40px 24px;text-align:center;">
              <h1 style="color:#3E2723;font-size:24px;font-weight:600;margin:0 0 12px;letter-spacing:-0.3px;">${heading}</h1>
              <p style="color:#8D7B6E;font-size:14px;line-height:1.6;margin:0 auto 36px;max-width:380px;">${subheading}</p>

              <!-- OTP BOX -->
              <table align="center" cellpadding="0" cellspacing="0" style="background:#FAF5EE;border:1.5px solid #E8DFD3;border-radius:14px;margin-bottom:28px;">
                <tr>
                  <td style="padding:28px 36px;">
                    <span style="font-size:44px;font-weight:700;color:#5D4037;letter-spacing:14px;font-family:'Courier New',monospace;">${otp}</span>
                  </td>
                </tr>
              </table>

              <!-- EXPIRY PILL -->
              <table align="center" cellpadding="0" cellspacing="0" style="background:rgba(184,115,51,0.1);border-radius:100px;margin-bottom:8px;">
                <tr>
                  <td style="padding:6px 14px;">
                    <span style="color:#B87333;font-size:11px;font-weight:600;letter-spacing:0.4px;">⏱ EXPIRES IN 10 MINUTES</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid #E8DFD3;"></div>
            </td>
          </tr>

          <!-- SECURITY NOTE -->
          <tr>
            <td style="padding:24px 40px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="vertical-align:top;width:32px;">
                    <div style="background:rgba(198,40,40,0.1);border-radius:8px;width:28px;height:28px;text-align:center;line-height:28px;">
                      <span style="color:#C62828;font-size:14px;">🔒</span>
                    </div>
                  </td>
                  <td style="padding-left:12px;">
                    <p style="color:#3E2723;font-size:13px;font-weight:600;margin:0 0 4px;">Keep this code private</p>
                    <p style="color:#8D7B6E;font-size:12px;line-height:1.5;margin:0;">NairaT will never ask you for this code outside the app. If you didn't request it, you can safely ignore this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#FAF5EE;padding:24px 40px;text-align:center;border-top:1px solid #E8DFD3;">
              <p style="color:#8D7B6E;font-size:12px;margin:0 0 4px;font-weight:500;">Naira<span style="color:#B87333;font-weight:700;">T</span> — Tokenized money for the way you spend.</p>
              <p style="color:#A89889;font-size:10.5px;margin:0;">© ${new Date().getFullYear()} NairaT · Polygon Mumbai testnet</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

async function sendOTP(toEmail, otp, purpose = "verification") {
  const subjects = {
    verification: "Your NairaT verification code",
    reset: "Reset your NairaT password",
  };

  try {
    await resend.emails.send({
      from: "NairaT <onboarding@resend.dev>",
      to: toEmail,
      subject: subjects[purpose] || subjects.verification,
      html: buildEmailHtml(otp, purpose),
    });
    return { success: true };
  } catch (err) {
    console.error("Email error:", err);
    return { success: false, error: err.message };
  }
}

module.exports = { sendOTP };