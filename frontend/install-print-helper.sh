#!/bin/bash
# Installs the Book Scanner print helper on a Mac.
#
# The helper checks the Book Scanner site about once a minute for SKU slip sheets sent
# from the phone and prints them on this Mac's default printer. It runs quietly in the
# background whenever you are logged in. To remove it, run this script with "remove".

set -e

SITE="https://sage-biscochitos-e77053.netlify.app"
DIR="$HOME/Library/Application Support/BookScannerPrint"
PLIST="$HOME/Library/LaunchAgents/app.bookscanner.print.plist"
LABEL="app.bookscanner.print"

if [ "$1" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DIR"
  echo "The print helper has been removed."
  exit 0
fi

echo "Book Scanner print helper"
echo

PRINTER=$(lpstat -d 2>/dev/null | sed -n 's/^system default destination: //p')
if [ -z "$PRINTER" ]; then
  echo "This Mac has no default printer set."
  echo "Open System Settings > Printers & Scanners, choose a default printer, then run this again."
  exit 1
fi
echo "Sheets will print on: $PRINTER"

printf "Enter the app passcode: "
read -r PASSCODE < /dev/tty

STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-app-passcode: $PASSCODE" "$SITE/api/print/next")
if [ "$STATUS" = "401" ]; then
  echo "That passcode was not accepted. Nothing was installed."
  exit 1
fi
if [ "$STATUS" != "200" ] && [ "$STATUS" != "204" ]; then
  echo "Could not reach the Book Scanner site (status $STATUS). Check the internet connection and run this again."
  exit 1
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents"

# The passcode is kept in a file only this user account can read.
printf '%s' "$PASSCODE" > "$DIR/passcode"
chmod 600 "$DIR/passcode"

cat > "$DIR/print-helper.sh" <<EOF
#!/bin/bash
# Fetches the next waiting sheet, if any, and prints it. Returns success when one printed.
DIR="\$HOME/Library/Application Support/BookScannerPrint"
fetch() {
  code=\$(curl -s -m 30 -o "\$DIR/job.pdf" -w '%{http_code}' -X POST -H "x-app-passcode: \$(cat "\$DIR/passcode")" "$SITE/api/print/next")
  [ "\$code" = "200" ] && lp "\$DIR/job.pdf" > /dev/null
}
# After a sheet prints, keep checking every few seconds for a while in case more follow.
if fetch; then
  for i in \$(seq 36); do sleep 5; fetch; done
fi
EOF
chmod 700 "$DIR/print-helper.sh"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DIR/print-helper.sh</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "Done. The helper is running and will start by itself each time you log in."
echo "On your phone, tap Print SKU slips. The first sheet can take up to a minute to start."
