//OMXPlayer + Wrapper anlegen
var OmxManager = require('omx-manager');
var manager = new OmxManager();

//gerade laufendes Video
var camera;

//WebSocketServer anlegen und starten
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Filesystem und Path Abfragen fuer Playlist
const fs = require('fs-extra');

//Befehle auf Kommandzeile ausfuehren
const { execSync } = require('child_process');

//Verzeichnis wo die Videos liegen
const videoDir = "/media/pi/usb_red/video";

//Wo liegen die Symlinks auf die Videos
const symlinkDir = "/home/pi/mh_prog/symlinkDir";

//Zeit wie lange bis Shutdown durchgefuhert wird bei Inaktivitaet
const countdownTime = 180;

//Aktuelle Infos zu Volume / Position in Song / Position innerhalb der Playlist / Playlist / PausedStatus / Random merken, damit Clients, die sich spaeter anmelden, diese Info bekommen
currentVolume = 50;
currentPosition = -1;
currentFiles = [];
currentPaused = false;
currentRandom = false;
currentActiveItem = "";
currentCountdownTime = countdownTime;

//Liste der konkreten Dateinamen (als symlinks)
symlinkFiles = [];

//wurde umschalten (und damit Video End Callback) vom Nutzer getriggert
userTriggeredChange = false;

//Countdown fuer Shutdown starten, weil gerade nichts passiert
var countdownID = setInterval(countdown, 1000);

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
                shutdown();
                break;

            //neue Playlist laden (ueber Browser-Aufruf) oder per RFID-Karte
            case "set-video-playlist": case "set-rfid-playlist":
                console.log(type + JSON.stringify(value));

                //Countdown fuer Shutdown wieder stoppen, weil nun etwas passiert
                clearInterval(countdownID);

                //Countdown-Zeit wieder zuruecksetzen
                currentCountdownTime = countdownTime;

                //Dateiliste (Anzeigenamen) zurecksetzen
                currentFiles = [];

                //Dateiliste (Dateinamen im Sytem) zuruecksetzen
                symlinkFiles = [];

                //Symlink-Dir leeren
                fs.emptyDirSync(symlinkDir);

                //Audio-Verzeichnis merken
                value.forEach((file, index) => {

                    //Dateinamen sammeln ("Conni back Pizza")
                    currentFiles.push(file.name);

                    //nummerertien Symlink erstellen
                    const srcpath = videoDir + "/" + file.mode + "/" + file.path;
                    const dstpath = symlinkDir + "/" + index + "-" + file.name + ".mp4";
                    fs.ensureSymlinkSync(srcpath, dstpath);

                    //Symlink-Dateinamen merken
                    symlinkFiles.push(dstpath);
                });

                //Playlist von vorne starten
                currentPosition = 0;

                //aktives Item setzen, wenn es sich nur um ein einzelnes Video handelt
                currentActiveItem = value.length === 1 ? value[0].path : "";

                //Nutzer hat vorheriges Video beendet durch Start der neuen Playlist
                userTriggeredChange = true;

                //Video starten
                startVideo();

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist, welches das active-item, file-list und resetteten countdown
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
                    },
                    {
                        type: "set-countdown-time",
                        value: currentCountdownTime
                    });
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

                        //User hat Ende des Videos getriggert => nicht automatisch einen Schritt weitergehen
                        userTriggeredChange = true;

                        //Video starten
                        startVideo();
                    }

                    //wir sind beim letzten Titel
                    else {
                        console.log("kein next beim letzten Titel");

                        //Wenn Titel pausiert war, wieder unpausen
                        if (currentPaused) {
                            camera.play();
                        }
                    }
                }

                //der vorherige Titel soll kommen
                else {

                    //Wenn wir nicht beim 1. Titel sind
                    if (currentPosition > 0) {

                        //zum vorherigen Titel springen
                        currentPosition -= 1;

                        //User hat Ende des Videos getriggert => nicht automatisch einen Schritt weitergehen
                        userTriggeredChange = true;

                        //Video starten
                        startVideo();
                    }

                    //wir sind beim 1. Titel
                    else {
                        console.log("1. Titel von vorne");

                        //10 min zurueck springen
                        camera.previousChapter();

                        //Wenn Titel pausiert war, wieder unpausen
                        if (currentPaused) {
                            camera.play();
                        }
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
                    currentPosition = value;

                    //Nutzer hat Track ausgewaehlt
                    userTriggeredChange = true;

                    //Video starten
                    startVideo();
                }

                //es wurde auf den bereits laufenden Titel geklickt
                else {

                    //10 min zurueck springen
                    camera.previousChapter();
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

                //Wenn es lauter werden soll
                if (value) {

                    //neue Lautstaerke merken (max. 100)
                    currentVolume = Math.min(100, currentVolume + 10);

                    //OMXPlayer lauter machen
                    camera.increaseVolume();
                }

                //es soll leiser werden
                else {

                    //neue Lautstaerke merken (min. 0)
                    currentVolume = Math.max(0, currentVolume - 10);

                    //OMXPlayer leiser machen
                    camera.decreaseVolume();
                }

                //Nachricht mit Volume an clients schicken 
                messageObjArr.push({
                    type: type,
                    value: currentVolume
                });
                break;

            //Pause-Status toggeln
            case 'toggle-paused-restart':

                //Wenn gerade pausiert, Video wieder abspielen
                if (currentPaused) {
                    camera.play();
                }

                //Video laueft gerade, also pausieren
                else {
                    camera.pause();
                }

                //Pausenstatus toggeln
                currentPaused = !currentPaused;

                //Nachricht an clients ueber Paused-Status
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });
                break;

            //Innerhalb des Titels spulen
            case "seek":

                //Vorwaertes spulen
                if (value) {
                    camera.seekForward();
                }

                //Rueckwarts spulen
                else {
                    camera.seekBackward();
                }
                break;
        }

        //Infos an Clients schicken
        sendClientInfo(messageObjArr);
    });

    //WS einmalig bei der Verbindung ueber div. Wert informieren
    let WSConnectObjectArr = [{
        type: "change-volume",
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

//Video starten
function startVideo() {

    //Symlink aus aktueller Position in Playlist ermitteln
    let video = symlinkFiles[currentPosition];
    console.log("play video " + video);

    //Wenn gerade ein Video laueft, dieses stoppen
    if (camera) {
        console.log("stop video");
        camera.stop();
    }

    //Start-Volumewert berechnen 0 -> -30.00 db, 100 -> 0.00 db)
    let vol = (100 - currentVolume) * -0.3;

    //Video mit schwarzem Hintergrund und passender Lautstaerke erzeugen und starten
    camera = manager.create(video, {
        "-b": true,
        "--vol": vol
    });
    camera.play();

    //Beim Ende eines Videos
    camera.on('end', function () {
        console.log("video ended");

        console.log("user trigger " + userTriggeredChange);

        //Wenn das Ende nicht vom Nutzer getriggert wurde (durch prev / next click)
        if (!userTriggeredChange) {
            console.log("end after playback");

            //Wenn wir noch nicht beim letzten Video waren
            if (currentPosition < (symlinkFiles.length - 1)) {
                console.log("play next video");

                //zum naechsten Item in der Playlist gehen
                currentPosition += 1;

                //Video starten
                startVideo();

                //Position-Infos an Clients schicken
                sendClientInfo([{
                    type: "set-position",
                    value: currentPosition
                }]);
            }

            //wir waren beim letzten Video
            else {
                console.log("playlist over");

                //Countdown fuer Shutdown zuruecksetzen und starten, weil gerade nichts mehr passiert
                countdownID = setInterval(countdown, 1000);

                //Position zuruecksetzen
                currentPosition = -1;

                //Aktives Item zuruecksetzen
                currentActiveItem = "";

                //Files zuruecksetzen
                currentFiles = [];

                //Clients informieren, dass Playlist fertig ist (position -1, activeItem "")
                let messageObjArr = [{
                    type: "set-position",
                    value: currentPosition
                },
                {
                    type: "active-item",
                    value: currentActiveItem
                },
                {
                    type: "set-files",
                    value: currentFiles
                }];

                //Infos an Clients schicken
                sendClientInfo(messageObjArr);
            }
        }

        //Video beendet, weil Nutzer prev / next geklickt hat
        else {
            console.log("video ended: triggered by user");

            //Flag zuruecksetzen
            userTriggeredChange = false;
        }
    });

    //Leicht verzoegert
    setTimeout(() => {

        //Flag zuruecksetzen
        console.log("Trigger false")
        userTriggeredChange = false;
    }, 500);
}

//Bei Inaktivitaet Countdown runterzaehlen und Shutdown ausfuehren
function countdown() {
    console.log("inactive");

    //Wenn der Countdown noch nicht abgelaufen ist
    if (currentCountdownTime >= 0) {
        console.log("shutdown in " + currentCountdownTime + " seconds");

        //Anzahl der Sekunden bis Countdown an Clients schicken
        sendClientInfo([{
            type: "set-countdown-time",
            value: currentCountdownTime
        }]);

        //Zeit runterzaehlen
        currentCountdownTime--;
    }

    //Countdown ist abgelaufen, Shutdown durchfuehren
    else {
        shutdown();
    }
}

//Pi herunterfahren und TV ausschalten
function shutdown() {
    console.log("shutdown");

    //Shutdown-Info an Clients schicken
    sendClientInfo([{
        type: "shutdown",
        value: ""
    }]);

    //TV ausschalten
    execSync("echo standby 0 | cec-client -s -d 1");

    //Pi herunterfahren
    execSync("shutdown -h now");
}