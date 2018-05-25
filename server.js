//OMXPlayer + Wrapper anlegen
//TODO

//WebSocketServer anlegen und starten
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Zeit Formattierung laden: [5, 13, 22] => 05:13:22
const timelite = require('timelite');

//Filesystem und Path Abfragen fuer Playlist
const path = require('path');
const fs = require('fs-extra');

//Befehle auf Kommandzeile ausfuehren
const { execSync } = require('child_process');

//Verzeichnis wo die Videos liegen
const videoDir = "/media/usb_red/video";

//Wo liegen die Symlinks auf die Videos
const symlinkDir = "/home/martin/mh_prog/symlinkDir";

//Aktuelle Infos zu Volume / Position in Song / Position innerhalb der Playlist / Playlist / PausedStatus / Random merken, damit Clients, die sich spaeter anmelden, diese Info bekommen
currentVolume = 50;
currentPosition = -1;
currentFiles = [];
currentPaused = false;
currentRandom = false;
currentActiveItem = "";

//Lautstaerke zu Beginn setzen
let initialVolumeCommand = "sudo amixer sset PCM " + currentVolume + "% -M";
console.log(initialVolumeCommand)
execSync(initialVolumeCommand);

//Wenn ein neues Video startet
//TODO
/*
player.on('next-video', () => {

    //
    currentPosition = + 1;

    //neue Position in Session-JSON-File schreiben
    writeSessionJson();

    //Position an Clients senden
    let messageObjArr = [{
        type: "set-position",
        value: currentPosition
    }];

    //Position-Infos an Clients schicken
    sendClientInfo(messageObjArr);
});
*/

//Wenn Playlist fertig ist
//TODO
/*
player.on('playlist-finish', () => {
    console.log("playlist finished");

    //Aktives Item zuruecksetzen
    currentActiveItem = "";

    //Clients informieren, dass Playlist fertig ist (position -1, activeItem "")
    let messageObjArr = [{
        type: "set-position",
        value: -1
    },
    {
        type: "active-item",
        value: currentActiveItem
    }];

    //Infos an Clients schicken
    sendClientInfo(messageObjArr);
});
*/

//Infos aus letzter Session auslesen
try {
    console.log("Load playlist from last session");

    //JSON-Objekt aus Datei holen
    const lastSessionObj = fs.readJsonSync('./lastSession.json');

    //Dateinamen aus letzter Session laden
    currentFiles = lastSessionObj.currentFiles;

    //Letztes aktives Item laden
    currentActiveItem = lastSessionObj.activeItem;

    //letzte Position in Playlist laden
    currentPosition = lastSessionObj.position;

    //diese Playlist zu Beginn spielen
    //TODO start video
}
catch (e) { }

//TimeFunktion starten, die aktuelle Laufzeit des Videos liefert
startTimer();

//Wenn sich ein WebSocket mit dem WebSocketServer verbindet
wss.on('connection', function connection(ws) {
    console.log("new client connected");

    //Wenn WS eine Nachricht an WSS sendet
    ws.on('message', function incoming(message) {

        //Nachricht kommt als String -> in JSON Objekt konvertieren
        var obj = JSON.parse(message);
        //console.log(obj)

        //Werte auslesen
        let type = obj.type;
        let value = obj.value;

        //Array von MessageObjekte erstellen, die an WS gesendet werden
        let messageObjArr = [];

        //Pro Typ gewisse Aktionen durchfuehren
        switch (type) {

            //System herunterfahren
            case "shutdown":
                console.log("shutdown");

                //Shutdown-Info an Clients senden
                messageObjArr.push({
                    type: "shutdown",
                    value: ""
                });

                //Shutdown-Info an Clients schicken
                sendClientInfo(messageObjArr);

                //Pi herunterfahren
                execSync("shutdown -h now");
                break;

            //neue Playlist laden (ueber Browser-Aufruf)
            case "set-video-playlist":
                console.log("set video-playlist " + JSON.stringify(value));

                //Dateiliste zurecksetzen
                currentFiles = [];

                //Symlink-Dir leeren
                fs.emptyDirSync(symlinkDir);

                //Audio-Verzeichnis merken
                value.forEach((file, index) => {

                    //Dateinamen sammeln ("Conni back Pizza")
                    currentFiles.push(file.name);

                    //nummerertien Symlink erstellen
                    const srcpath = videoDir + "/" + file.mode + "/" + file.path;
                    const dstpath = symlinkDir + "/" + index + "-" + file.name + ".mp4";
                    fs.ensureSymlinkSync(srcpath, dstpath)
                });

                //Playlist von vorne starten
                currentPosition = 0;

                //aktives Item setzen, wenn es sich nur um ein einzelnes Video handelt
                currentActiveItem = value.length === 1 ? value[0].path : "";

                //Files, Position, etc. Session-JSON-File schreiben
                writeSessionJson();

                //TODO
                //start video

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist, welches das active-item und file-list
                messageObjArr.push(
                    {
                        type: "toggle-paused",
                        value: currentPaused
                    },
                    {
                        type: "active-item",
                        value: currentActiveItem
                    },
                    {
                        type: "set-files",
                        value: currentFiles
                    },
                    {
                        type: "set-position",
                        value: currentPosition
                    })
                    ;
                break;

            //neue Setlist laden (per RFID-Karte)
            case "set-rfid-playlist":

                //TODO: zusammen mit Playlist moeglich?
                break;

            //Video wurde vom Nutzer weitergeschaltet
            case 'change-item':
                console.log("change-item " + value);

                //wenn der naechste Song kommen soll
                if (value) {

                    //Wenn wir noch nicht beim letzten Titel sind
                    if (currentPosition < (currentFiles.length - 1)) {

                        //zum naechsten Titel springen
                        currentPosition += 1;
                        //TODO
                        //player.next();
                    }

                    //wir sind beim letzten Titel
                    else {

                        //Wenn Titel pausiert war, wieder unpausen
                        if (currentPaused) {

                            //TODO
                            //player.playPause();
                        }
                        console.log("kein next beim letzten Track");
                    }
                }

                //der vorherige Titel soll kommen
                else {

                    //Wenn wir nicht beim 1. Titel sind
                    if (currentPosition > 0) {

                        //zum vorherigen Titel springen
                        currentPosition -= 1;
                        //TODO
                        //player.previous();
                    }

                    //wir sind beim 1. Titel
                    else {

                        //Playlist nochmal von vorne starten
                        //TODO
                        //player.seekPercent(0);
                        console.log("1. Titel von vorne");

                        //Wenn Titel pausiert war, wieder unpausen
                        //TODO check
                        /*
                        if (currentPaused) {
                            player.playPause();
                        }
                        */
                    }
                }

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Nachricht an clients, dass nun nicht mehr pausiert ist und neue Position
                messageObjArr.push(
                    {
                        type: "toggle-paused",
                        value: currentPaused
                    }, {
                        type: "set-position",
                        value: currentPosition
                    });
                break;

            //Sprung zu einem bestimmten Titel in Playlist
            case "jump-to":

                //Wie viele Schritte in welche Richtung springen?
                let jumpTo = value - currentPosition;
                console.log("jump-to " + jumpTo);

                //wenn nicht auf den bereits laufenden geklickt wurde
                if (jumpTo !== 0) {

                    //zu gewissem Titel springen
                    //TODO
                    currentPosition = value;
                    //player.exec("pt_step " + jumpTo);
                }

                //es wurde auf den bereits laufenden Titel geklickt
                else {

                    //diesen wieder von vorne abspielen
                    //TODO
                    //player.seekPercent(0);
                }

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Nachricht an clients, dass nun nicht mehr pausiert ist und aktuelle Position in Playlist
                messageObjArr.push(
                    {
                        type: "toggle-paused",
                        value: currentPaused
                    }, {
                        type: "set-position",
                        value: currentPosition
                    });
                break;

            //Lautstaerke aendern
            case 'change-volume':

                //Wenn es lauter werden soll, max. 100 setzen
                if (value) {
                    currentVolume = Math.min(100, currentVolume + 10);
                }

                //es soll leiser werden, min. 0 setzen
                else {
                    currentVolume = Math.max(0, currentVolume - 10);
                }

                //Lautstaerke setzen
                let changeVolumeCommand = "sudo amixer sset PCM " + currentVolume + "% -M";
                console.log(changeVolumeCommand)
                execSync(changeVolumeCommand);

                //Nachricht mit Volume an clients schicken 
                messageObjArr.push({
                    type: type,
                    value: currentVolume
                });
                break;

            //Lautstaerke setzen
            case 'set-volume':

                //neue Lautstaerke merken 
                currentVolume = value;

                //Lautstaerke setzen
                let setVolumeCommand = "sudo amixer sset PCM " + value + "% -M";
                console.log(setVolumeCommand)
                execSync(setVolumeCommand);

                //Nachricht mit Volume an clients schicken 
                messageObjArr.push({
                    type: type,
                    value: currentVolume
                });
                break;

            //Pause-Status toggeln
            case 'toggle-paused':

                //Pausenstatus toggeln
                currentPaused = !currentPaused;

                //Pause toggeln
                //TODO
                //player.playPause();

                //Nachricht an clients ueber Paused-Status
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });
                break;

            //Innerhalb des Titels spulen
            case "seek":

                //seek in item
                //TODO
                //player.seek(seekTo);
                break;
        }

        //Infos an Clients schicken
        sendClientInfo(messageObjArr);
    });

    //WS einmalig bei der Verbindung ueber div. Wert informieren
    let WSConnectObjectArr = [{
        type: "set-volume",
        value: currentVolume
    }, {
        type: "set-position",
        value: currentPosition
    }, {
        type: "toggle-paused",
        value: currentPaused
    }, {
        type: "set-files",
        value: currentFiles
    }, {
        type: "active-item",
        value: currentActiveItem
    }];

    //Ueber Objekte gehen, die an WS geschickt werden
    WSConnectObjectArr.forEach(messageObj => {

        //Info an WS schicken
        ws.send(JSON.stringify(messageObj));
    });
});

//Timer-Funktion benachrichtigt regelmaessig die WS ueber aktuelle Position des Tracks
function startTimer() {
    console.log("startTimer");

    //Wenn time_pos property geliefert wirde
    //TODO
    /*
    player.on('time_pos', (totalSecondsFloat) => {

        //Float zu int: 13.4323 => 13
        let totalSeconds = Math.trunc(totalSecondsFloat);
        console.log('track progress is', totalSeconds);

        //Umrechung der Sekunden in [h, m, s] fuer formattierte Darstellung
        let hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        let minutes = Math.floor(totalSeconds / 60);
        let seconds = totalSeconds % 60;

        //h, m, s-Werte in Array packen
        let output = [hours, minutes, seconds];

        //[2,44,1] => 02:44:01
        let outputString = timelite.time.str(output);

        //Time-MessageObj erstellen
        let messageObjArr = [{
            type: "time",
            value: outputString
        }];

        //Clients ueber aktuelle Zeit informieren
        sendClientInfo(messageObjArr);
    });

    //Jede Sekunde die aktuelle Zeit innerhalb des Tracks liefern
    setInterval(() => {
        player.getProps(['time_pos']);
    }, 1000);
    */
}

//Infos der Session in File schreiben
function writeSessionJson() {

    //Position in Playlist zusammen mit anderen Merkmalen merken fuer den Neustart
    fs.writeJsonSync('./lastSession.json',
        {
            currentFiles: currentFiles,
            activeItem: currentActiveItem,
            position: currentPosition
        });
}

//Infos ans WS-Clients schicken
function sendClientInfo(messageObjArr) {

    //Ueber Liste der MessageObjekte gehen
    messageObjArr.forEach(messageObj => {
        //console.log(messageObj)

        //Ueber Liste der WS gehen und Nachricht schicken
        for (ws of wss.clients) {
            try {
                ws.send(JSON.stringify(messageObj));
            }
            catch (e) { }
        }
    });
}