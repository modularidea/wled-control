#!/bin/sh
# Send one command to a WLED controller over USB serial. Works without Obsidian, and alongside the
# plugin if it has the port open (writes from several processes don't conflict).
#
# Usage: wled-serial.sh [-p PORT] [-b BAUD] [COMMAND]
#   COMMAND  toggle (default) | on | off | bri=0-255 | preset=N | a raw JSON object
#   PORT     default: $WLED_SERIAL_PORT, else the only /dev/cu.usb* port found
#   BAUD     default 115200 (irrelevant for native USB controllers)
#
# Example for the macOS Shortcuts app ("Run Shell Script" action):
#   /path/to/wled-serial.sh toggle

set -u

PORT=${WLED_SERIAL_PORT:-}
BAUD=115200

while getopts "p:b:" opt; do
	case $opt in
		p) PORT=$OPTARG ;;
		b) BAUD=$OPTARG ;;
		*) echo "usage: $0 [-p PORT] [-b BAUD] [COMMAND]" >&2; exit 2 ;;
	esac
done
shift $((OPTIND - 1))
COMMAND=${1:-toggle}

case $COMMAND in
	toggle) JSON='{"on":"t"}' ;;
	on) JSON='{"on":true}' ;;
	off) JSON='{"on":false}' ;;
	bri=*)
		VALUE=${COMMAND#bri=}
		case $VALUE in
			'' | *[!0-9]*) echo "bri expects a number from 0 to 255" >&2; exit 2 ;;
		esac
		[ "$VALUE" -le 255 ] || { echo "bri expects a number from 0 to 255" >&2; exit 2; }
		JSON="{\"bri\":$VALUE}"
		;;
	preset=*)
		VALUE=${COMMAND#preset=}
		case $VALUE in
			'' | *[!0-9]*) echo "preset expects a number" >&2; exit 2 ;;
		esac
		JSON="{\"ps\":$VALUE}"
		;;
	'{'*) JSON=$COMMAND ;;
	*) echo "unknown command: $COMMAND" >&2; exit 2 ;;
esac

if [ -z "$PORT" ]; then
	# Unquoted on purpose: let the shell expand the globs.
	set -- /dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/ttyACM* /dev/ttyUSB*
	FOUND=
	COUNT=0
	for candidate in "$@"; do
		[ -e "$candidate" ] || continue
		FOUND="$FOUND $candidate"
		COUNT=$((COUNT + 1))
	done
	case $COUNT in
		0) echo "no USB serial port found - is the controller plugged in?" >&2; exit 1 ;;
		1) PORT=${FOUND# } ;;
		*) echo "several ports found, pick one with -p or WLED_SERIAL_PORT:$FOUND" >&2; exit 1 ;;
	esac
fi

# Opening with <> would silently create a regular file for a mistyped path.
[ -c "$PORT" ] || { echo "$PORT is not a serial device - is the controller plugged in?" >&2; exit 1; }

if [ "$(uname)" = "Darwin" ]; then DEVICE_FLAG=-f; else DEVICE_FLAG=-F; fi

# Open read/write first: macOS resets termios when the last process closes the port, so stty must
# run while we hold it. -hupcl keeps DTR up on close, which would reset some boards.
exec 3<>"$PORT" || { echo "cannot open $PORT" >&2; exit 1; }
stty "$DEVICE_FLAG" "$PORT" "$BAUD" raw -echo -hupcl || { echo "cannot configure $PORT" >&2; exit 1; }
printf '%s\n' "$JSON" >&3
# Let the driver flush the line before the port closes.
sleep 0.3
exec 3>&-
