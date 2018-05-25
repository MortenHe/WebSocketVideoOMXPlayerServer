#!/bin/bash
cd /home/pi/mh_prog/WebSocketVideoOMXPlayerServer
/usr/bin/sudo /usr/bin/node ./server.js > /home/pi/mh_prog/output-server.txt &
/bin/sleep 2
cd /home/pi/mh_prog/WebSocketGPIO
/usr/bin/sudo /usr/bin/node ./button.js > /home/pi/mh_prog/output-button.txt &