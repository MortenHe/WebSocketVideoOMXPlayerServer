#!/bin/bash
cd /home/pi/mh_prog/WebSocketAudioMplayerServer
/usr/bin/node ./server.js &
sleep 2
cd /home/pi/mh_prog/WebSocketGPIO
/usr/bin/node ./button.js &