//OMXPlayer + Wrapper anlegen
var omxp = require('omxplayer-controll');

//WebSocketServer anlegen und starten
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Zeit Formattierung laden: [5, 13, 22] => 05:13:22
const timelite = require('timelite');

//Filesystem und Path Abfragen fuer Playlist
const fs = require('fs-extra');

//Befehle auf Kommandzeile ausfuehren
const { execSync } = require('child_process');

//Verzeichnis wo die Videos liegen
const videoDir = "/media/pi/usb_red/video";

//Wo liegen die Symlinks auf die Videos
const symlinkDir = "/home/pi/mh_prog/symlinkDir";

//Symlink Verzeichnis leeren
fs.emptyDirSync(symlinkDir);

//Zeit wie lange bis Shutdown durchgefuhert wird bei Inaktivitaet
const countdownTime = 180;

//Aktuelle Infos zu Volume, etc. merken, damit Clients, die sich spaeter anmelden, diese Info bekommen
currentVolume = 50;
currentPosition = 0;
currentFiles = [];
currentFilesTotalTime = null;
currentPaused = false;
currentCountdownTime = countdownTime;
currentTime = 0;
currentPlaylistStarted = false;

//Anzahl der Sekunden des aktuellen Tracks
var trackTotalTime = 0;

//Summe der h, m, s der Dateien, die Playlist nach aktueller Position kommen
var followingTracksTimeString = "00:00:00";

//Liste der konkreten Dateinamen (als symlinks)
symlinkFiles = [];

//wurde umschalten (und damit Video End Callback) vom Nutzer getriggert
userTriggeredChange = false;

//Countdown fuer Shutdown starten, weil gerade nichts passiert
var countdownID = setInterval(countdown, 1000);

//Jede Sekunde, die aktuelle Position des Videos ermitteln
setInterval(getPos, 1000);

//Beim Ende eines Videos
omxp.on('finish', function () {
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
            currentPosition = 0;

            //Files zuruecksetzen
            currentFiles = [];

            //Symlink files zuruecksetzen
            symlinkFiles = [];

            //Symlink Verzeichnis leeren
            fs.emptyDirSync(symlinkDir);

            //Es laueft gerade keine Playlist
            currentPlaylistStarted = false;

            //Clients informieren, dass Playlist fertig ist (position 0)
            let messageObjArr = [{
                type: "set-position",
                value: currentPosition
            },
            {
                type: "set-files",
                value: currentFiles
            },
            {
                type: "set-playlist-started",
                value: currentPlaylistStarted
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

//Wenn sich ein WebSocket mit dem WebSocketServer verbindet
wss.on('connection', function connection(ws) {
    console.log("new client connected");

    //Wenn WS eine Nachricht an WSS sendet
    ws.on('message', function incoming(message) {

        //Nachricht kommt als String -> in JSON Objekt konvertieren
        var obj = JSON.parse(message);

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
            case "add-to-video-playlist": case "set-rfid-playlist":
                console.log(type + JSON.stringify(value));

                //Countdown fuer Shutdown wieder stoppen, weil nun etwas passiert
                clearInterval(countdownID);

                //Countdown-Zeit wieder zuruecksetzen
                currentCountdownTime = countdownTime;

                //Ermitteln an welcher Stelle / unter welchem Namen die neue Datei eingefuegt
                let nextIndex = currentFiles.length;

                //Dateiobjekt sammeln ("Conni back Pizza", "00:13:05", "kinder/conni/conni-backt-pizza.mp4")
                currentFiles.push({
                    "file": value.file,
                    "name": value.name,
                    "length": value.length
                });
                console.log("current files:\n" + currentFiles);

                //Laengen-Merkmal aus Playlist-Array extrahieren und addieren
                let playlist_length_array = timelite.time.add(currentFiles.map(item => item.length));

                //Ergebnis als String: [0, 5, 12] -> "00:05:12" liefern
                currentFilesTotalTime = timelite.time.str(playlist_length_array);
                console.log(currentFilesTotalTime)

                //nummerertien Symlink erstellen
                const srcpath = videoDir + "/" + value.file;
                const dstpath = symlinkDir + "/" + nextIndex + "-" + value.name + ".mp4";
                fs.ensureSymlinkSync(srcpath, dstpath);

                //Symlink-Dateinamen merken
                symlinkFiles.push(dstpath);
                console.log("symlink files:\n" + symlinkFiles);

                //Video starten, wenn flag gesetzt ist
                if (value.startPlayback) {
                    startVideo();

                    //Es ist nicht mehr pausiert
                    currentPaused = false;

                    //Die Playlist wurde gestartet
                    currentPlaylistStarted = true;
                }

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist, welches das active-item, file-list und resetteten countdown
                messageObjArr.push(
                    {
                        type: "toggle-paused",
                        value: currentPaused
                    },
                    {
                        type: "set-files",
                        value: currentFiles
                    },
                    {
                        type: "set-countdown-time",
                        value: currentCountdownTime
                    },
                    {
                        type: "set-files-total-time",
                        value: currentFilesTotalTime
                    },
                    {
                        type: "set-playlist-started",
                        value: currentPlaylistStarted
                    }
                );
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

                        //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
                        updatePlaylistTimes();

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
                            omxp.playPause();
                        }
                    }
                }

                //der vorherige Titel soll kommen
                else {

                    //Wenn wir nicht beim 1. Titel sind
                    if (currentPosition > 0) {

                        //zum vorherigen Titel springen
                        currentPosition -= 1;

                        //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
                        updatePlaylistTimes();

                        //User hat Ende des Videos getriggert => nicht automatisch einen Schritt weitergehen
                        userTriggeredChange = true;

                        //Video starten
                        startVideo();
                    }

                    //wir sind beim 1. Titel
                    else {
                        console.log("1. Titel von vorne");

                        //10 min zurueck springen
                        omxp.setPosition(0);

                        //Wenn Titel pausiert war, wieder unpausen
                        if (currentPaused) {
                            omxp.playPause();
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

                //wenn nicht auf das bereits laufende Video geklickt wurde
                if (jumpTo !== 0) {

                    //zu gewissem Titel springen
                    currentPosition = value;

                    //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
                    updatePlaylistTimes();

                    //Nutzer hat Track ausgewaehlt
                    userTriggeredChange = true;

                    //Video starten
                    startVideo();
                }

                //es wurde auf den bereits laufenden Titel geklickt
                else {

                    //10 min zurueck springen
                    omxp.setPosition(0);
                }

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Wenn Playlist noch nicht lief
                if (!currentPlaylistStarted) {

                    //Sie als gestartet markieren
                    currentPlaylistStarted = true;

                    //Und dem Nutzer mitteilen
                    messageObjArr.push({
                        type: "set-playlist-started",
                        value: currentPlaylistStarted
                    });
                }

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
                }

                //es soll leiser werden
                else {

                    //neue Lautstaerke merken (min. 0)
                    currentVolume = Math.max(0, currentVolume - 10);
                }

                //OMXPlayer lauter machen
                omxp.setVolume(currentVolume / 100);

                //Nachricht mit Volume an clients schicken 
                messageObjArr.push({
                    type: type,
                    value: currentVolume
                });
                break;

            //Pause-Status toggeln
            case 'toggle-paused-restart':

                //Wenn gerade pausiert, Video wieder abspielen
                omxp.playPause();

                //Pausenstatus toggeln
                currentPaused = !currentPaused;

                //Nachricht an clients ueber Paused-Status
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });
                break;

            //Video stoppen
            case "stop":

                //Nutzer hat das Video beendet
                userTriggeredChange = true;

                //Player stoppen
                omxp.hideVideo();

                //Countdown fuer Shutdown zuruecksetzen und starten, weil gerade nichts mehr passiert
                countdownID = setInterval(countdown, 1000);

                //Position zuruecksetzen
                currentPosition = 0;

                //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
                updatePlaylistTimes();

                //Files zuruecksetzen
                currentFiles = [];

                //Symlink files zuruecksetzen
                symlinkFiles = [];

                //Symlink Verzeichnis leeren
                fs.emptyDirSync(symlinkDir);

                //Playlist laueft nicht mehr
                currentPlaylistStarted = false;

                //Infos an Client schicken, damit Playlist dort zurueckgesetzt wird
                messageObjArr.push(
                    {
                        type: "set-position",
                        value: currentPosition
                    },
                    {
                        type: "set-files",
                        value: currentFiles
                    },
                    {
                        type: "set-playlist-started",
                        value: currentPlaylistStarted
                    });
                break;

            //Innerhalb des Titels spulen
            case "seek":

                //in welche Richtung wird gespielt
                let offset = value ? 1000 : -1000

                //Neue Position berechnen
                let newPosition = (currentTime * 100) + offset;

                //spulen
                omxp.setPosition(newPosition);

                //Neu (errechnete) Zeit setzen, damit mehrmaliges Spulen funktioniert
                currentTime = newPosition / 100;
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
        type: "set-files-total-time",
        value: currentFilesTotalTime
    }, {
        type: "set-playlist-started",
        value: currentPlaylistStarted
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

    //OPtionen fuer neues Video
    let opts = {
        'audioOutput': 'hdmi',
        'blackBackground': true,
        'disableKeys': true,
        'disableOnScreenDisplay': false,
        'disableGhostbox': true,
        'startAt': 0,
        'startVolume': (currentVolume / 100) //0.0 ... 1.0 default: 1.0
    };

    //Video starten
    //omxp.open(video, opts);
}

//Bei Inaktivitaet Countdown runterzaehlen und Shutdown ausfuehren
function countdown() {
    //console.log("inactive");

    //Wenn der Countdown noch nicht abgelaufen ist
    if (currentCountdownTime >= 0) {
        //console.log("shutdown in " + currentCountdownTime + " seconds");

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

//Position in Video ermitteln
function getPos() {

    //Position anfordern
    omxp.getPosition(function (err, trackSecondsFloat) {

        //if (trackSecondsFloat) {

        trackSecondsFloat = 0;

        //Umrechnung zu Sek: 1343 => 13 Sek
        let trackSeconds = Math.trunc(trackSecondsFloat / 100);

        //currentTime merken (fuer seek mit setPosition)
        currentTime = trackSeconds;
        console.log('track progress is', trackSeconds);

        //Restzeit des aktuellen Tracks berechnen
        let trackSecondsRemaining = trackTotalTime - trackSeconds;
        console.log(trackSecondsRemaining);

        //Timelite String errechnen fuer verbleibende Zeit des Tracks
        let trackSecondsRemainingString = generateTimeliteStringFromSeconds(trackSecondsRemaining);
        console.log(trackSecondsRemainingString)
        console.log(followingTracksTimeString);

        //jetzt berechnen wie lange die gesamte Playlist noch laeuft: Restzeit des aktuellen Tracks + Summe der Gesamtlaenge der folgenden Tracks
        currentFilesTotalTime = timelite.time.str(timelite.time.add([trackSecondsRemainingString, followingTracksTimeString]));
        console.log(currentFilesTotalTime);

        //Clients ueber aktuelle Zeiten informieren
        sendClientInfo([{
            type: "time",
            value: generateTimeliteStringFromSeconds(trackSecondsRemainingString)
        },
        {
            type: "set-files-total-time",
            value: currentFilesTotalTime
        }]);
        //}
    });
}

//Merken wie lange der aktuelle Track geht und ausrechnen wie lange die noch folgenden Tracks der Playlist dauern
function updatePlaylistTimes() {

    //Anzahl der Sekunden der aktuellen Datei berechnen und merken
    let file = currentFiles[currentPosition]["length"];
    trackTotalTime = parseInt(file.substring(0, 2)) * 3600 + parseInt(file.substring(3, 5)) * 60 + parseInt(file.substring(6, 8));

    //Laenge der Files aufsummieren, die nach aktueller Position kommen
    followingTracksTimeString = timelite.time.str(timelite.time.add(
        currentFiles
            .filter((file, pos) => pos > currentPosition)
            .map(file => file["length"])));

    console.log("new follow " + followingTracksTimeString);
}

//Aus Sekundenzahl Timelite Array [h, m, s] bauen
function generateTimeliteStringFromSeconds(secondsTotal) {

    //Umrechung der Sekunden in [h, m, s] fuer formattierte Darstellung
    let hours = Math.floor(secondsTotal / 3600);
    secondsTotal %= 3600;
    let minutes = Math.floor(secondsTotal / 60);
    let seconds = secondsTotal % 60;

    //h, m, s-Werte in Array packen
    return timelite.time.str([hours, minutes, seconds]);
}