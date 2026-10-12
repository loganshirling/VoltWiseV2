# Privacy and data handling

VoltWise is a browser-only analysis application. The current application code has no backend API, account system, analytics endpoint, or cloud project store. Load data, resource CSVs, tariff settings, battery/generation settings, and calculations are read and processed in the user's browser, including Web Workers for simulation work. The application does not upload those inputs to Google Fonts or another application service.

The page does make third-party font requests to Google Fonts (`fonts.googleapis.com` and `fonts.gstatic.com`). Those requests can expose ordinary connection metadata such as the visitor's IP address, browser/network information, and requested font resources to Google. Users requiring no third-party font requests can block those domains; the application remains usable with fallback system fonts.

The static page itself must be downloaded from its hosting origin. Hosting providers and network intermediaries may apply their own request logging, which is outside VoltWise's browser code and must be checked for the chosen deployment.

## Files and persistence

Selected CSVs are read in memory by the browser. VoltWise does not save project inputs to application storage across reloads, and it does not add automatic local or cloud recovery. The interface tracks unsaved edits in memory, warns before discarding them, and asks the browser to warn when closing or reloading a dirty workspace. **Save Project** creates a downloadable JSON archive containing the current configuration, load CSV/provenance, financial assumptions, site time zone, and any imported resource intervals. The separate analysis export contains results and their assumptions. The user chooses where those files are saved; they are ordinary local files and are not encrypted by the application. Protect, back up, or delete them using the operating system's normal file tools.

Reset clears active project data in the page; it does not delete archives or exported files already downloaded. Closing or reloading the page discards the in-memory workspace unless it was saved by the user. VoltWise does not automatically transmit input data when saving or exporting.

## Deployment security

Local processing does not by itself make a hosted deployment secure. This repository does not identify or configure a production host, and production HTTPS, content-security policy, frame protection, transport-security headers, and hosting logs have not been independently verified. The deployment operator must verify HTTPS and an appropriate security-header policy for the selected host before describing the deployment as secure. The Google Fonts requests must be accounted for in any content-security policy; see the [release runbook](release-runbook.md).
