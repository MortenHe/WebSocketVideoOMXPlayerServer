//OMXPlayer + Wrapper anlegen
var omxp = require('omxplayer-controll');

//WebSocketServer anlegen und starten
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Zeit Formattierung laden: [5, 13, 22] => 05:13:22
const timelite = require('timelite');

//Filesystem und Path Abfragen fuer Playlist
const fs = require('fs-extra');
const path = require('path');

//Befehle auf Kommandzeile ausfuehren
const { execSync } = require('child_process');

//Verzeichnis wo die Videos liegen
//Aus Config auslesen wo die Audio-Dateien liegen
const configFile = fs.readJsonSync('config.json');
const videoDir = configFile["videoDir"];

//Wo liegen die Symlinks auf die Videos
const symlinkDir = "/home/pi/mh_prog/symlinkDir";

//Symlink Verzeichnis leeren
fs.emptyDirSync(symlinkDir);

//Zeit wie lange bis Shutdown durchgefuhert wird bei Inaktivitaet
const countdownTime = 180;

//Aktuelle Infos zu Volume, etc. merken, damit Clients, die sich spaeter anmelden, diese Info bekommen
data = [];
data["volume"] = 50;
data["position"] = -1;
data["files"] = [];
data["fileTime"] = 0;
data["filesTotalTime"] = null;
data["paused"] = false;
data["countdownTime"] = countdownTime;
data["time"] = 0;

//Anzahl der Sekunden des aktuellen Tracks
var trackTotalTime = 0;

//Summe der h, m, s der Dateien, die Playlist nach aktueller Position kommen
var followingTracksTimeString = "00:00:00";

//Liste der konkreten Dateinamen (als symlinks)
symlinkFiles = [];

//Countdown fuer Shutdown starten, weil gerade nichts passiert
var countdownID = setInterval(countdown, 1000);

//Wenn ein Video laeuft, ermitteln wo wir gerade sind und ob Video noch laueft
timeAndStatusIntervalID = null;

//Wenn sich ein WebSocket-Client mit dem WebSocketServer verbindet
wss.on('connection', function connection(ws) {
    console.log("new client connected");

    //Wenn Client eine Nachricht an WSS sendet
    ws.on('message', function incoming(message) {

        //Nachricht kommt als String -> in JSON Objekt konvertieren
        var obj = JSON.parse(message);
        let type = obj.type;
        let value = obj.value;

        //Array von MessageObjekte erstellen, die an WS gesendet werden
        let messageArr = [];

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
                data["countdownTime"] = countdownTime;

                //Wenn Video gestartet werden soll, bisherige Playlist zuruecksetzen
                if (value.startPlayback) {
                    resetPlaylist();
                }

                //Ermitteln an welcher Stelle / unter welchem Namen die neue Datei eingefuegt wird
                let nextIndex = data["files"].length;

                //Dateiobjekt sammeln ("Conni back Pizza", "00:13:05", "kinder/conni/conni-backt-pizza.mp4")
                data["files"].push({
                    "file": value.file,
                    "name": value.name,
                    "length": value.length
                });
                console.log("current files:\n" + JSON.stringify(data["files"]));

                //Laengen-Merkmal aus Playlist-Array extrahieren und addieren
                let playlist_length_array = timelite.time.add(data["files"].map(item => item.length));

                //Ergebnis als String: [0, 5, 12] -> "00:05:12" liefern
                data["filesTotalTime"] = timelite.time.str(playlist_length_array);
                console.log(data["filesTotalTime"])

                //nummerierten Symlink erstellen
                const srcpath = videoDir + "/" + value.file;
                const dstpath = symlinkDir + "/" + nextIndex + "-" + path.basename(value.file);
                fs.ensureSymlinkSync(srcpath, dstpath);

                //Symlink-Dateinamen merken
                symlinkFiles.push(dstpath);
                console.log("symlink files:\n" + symlinkFiles);

                //wenn flag gesetzt ist
                if (value.startPlayback) {

                    //beim 1. Video beginnen, Video starte und Pausierung zuruecksetzen
                    data["position"] = 0;
                    startVideo();
                    data["paused"] = false;
                }

                //Gesamtspielzeit der Playlist anpassen
                updatePlaylistTimes();

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist, welches das active-item, file-list und resetteten countdown
                messageArr.push("paused", "position", "files", "countdownTime", "filesTotalTime");
                break;

            //Video wurde vom Nutzer weitergeschaltet
            case 'change-item':
                console.log("change-item " + value);

                //wenn das naechste Video kommen soll
                if (value) {

                    //Wenn wir noch nicht beim letzten Titel sind, zum naechsten Video springen und Video starten
                    if (data["position"] < (data["files"].length - 1)) {
                        data["position"] += 1;
                        startVideo();
                    }

                    //wir sind beim letzten Titel
                    else {
                        console.log("kein next beim letzten Titel");

                        //Wenn Titel pausiert war, wieder unpausen
                        if (data["paused"]) {
                            omxp.playPause();
                        }
                    }
                }

                //das vorherige Video soll kommen
                else {

                    //Wenn wir nicht beim 1. Titel sind, zum vorherigen Video springen und Video starten
                    if (data["position"] > 0) {
                        data["position"] -= 1;
                        startVideo();
                    }

                    //wir sind beim 1. Titel
                    else {
                        console.log("1. Titel von vorne");

                        //Titel von vorne starten
                        omxp.setPosition(0);

                        //Wenn Titel pausiert war, wieder unpausen
                        if (data["paused"]) {
                            omxp.playPause();
                        }
                    }
                }

                //Pausierung zuruecksetzen und Clients informieren
                data["paused"] = false;

                //Nachricht an clients, dass nun nicht mehr pausiert ist und neue Position
                messageArr.push("paused", "position");
                break;

            //Sprung zu einem bestimmten Video in Playlist
            case "jump-to":

                //Wie viele Schritte in welche Richtung springen?
                let jumpTo = value - data["position"];
                console.log("jump-to " + jumpTo);

                //wenn nicht auf das bereits laufende Video geklickt wurde
                if (jumpTo !== 0) {

                    //zu gewissem Titel springen
                    data["position"] = value;

                    //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
                    updatePlaylistTimes();

                    //Video starten
                    startVideo();
                }

                //es wurde auf den bereits laufenden Titel geklickt, Video von vorne starten
                else {
                    omxp.setPosition(0);
                }

                //Pausierung zuruecksetzen und Clients informieren
                data["paused"] = false;
                messageArr.push("paused", "position");
                break;

            //Lautstaerke aendern
            case 'change-volume':

                //Wenn es lauter werden soll, max 100
                if (value) {
                    data["volume"] = Math.min(100, data["volume"] + 10);
                }

                //es soll leiser werden, min. 0
                else {
                    data["volume"] = Math.max(0, data["volume"] - 10);
                }

                //Lautstaerke anpassen und Clients informieren
                omxp.setVolume(data["volume"] / 100);
                messageArr.push("volume");
                break;

            //Pause-Status toggeln
            case 'toggle-play-pause':

                //Wenn gerade pausiert, Video wieder abspielen
                omxp.playPause();

                //Pausenstatus toggeln und Clients informieren
                data["paused"] = !data["paused"];
                messageArr.push("paused");
                break;

            //Video stoppen
            case "stop":

                //Player pausieren und Video ausblenden (stop Funktion geht derzeit nicht)
                omxp.hideVideo();
                omxp.playPause();

                //Countdown fuer Shutdown zuruecksetzen und starten, weil gerade nichts mehr passiert
                countdownID = setInterval(countdown, 1000);

                //Position zuruecksetzen
                data["position"] = -1;

                //Playlist zuruecksetzen
                resetPlaylist();

                //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
                updatePlaylistTimes();

                //Infos an Client schicken, damit Playlist dort zurueckgesetzt wird
                messageArr.push("position", "files");
                break;

            //Innerhalb des Titels spulen
            case "seek":

                //in welche Richtung wird gespielt
                let offset = value ? 1000 : -1000

                //Neue Position berechnen
                let newPosition = (data["time"] * 100) + offset;

                //spulen
                omxp.setPosition(newPosition);

                //Neu (errechnete) Zeit setzen, damit mehrmaliges Spulen funktioniert
                data["time"] = newPosition / 100;
                break;
        }

        //Infos an Clients schicken
        sendClientInfo(messageArr);
    });

    //WS einmalig bei der Verbindung ueber div. Wert informieren
    let WSConnectMessageArr = ["volume", "position", "paused", "files", "filesTotalTime"];

    //Ueber Messages gehen, die an Clients geschickt werden
    WSConnectMessageArr.forEach(message => {

        //Message-Object erzeugen und an Client schicken
        let messageObj = {
            "type": message,
            "value": data[message]
        };
        ws.send(JSON.stringify(messageObj));
    });
});

//Infos ans WS-Clients schicken
function sendClientInfo(messageArr) {

    //Ueber Liste der Messages gehen
    messageArr.forEach(message => {

        //Message-Object erzeugen
        let messageObj = {
            "type": message,
            "value": data[message]
        };

        //Ueber Liste der Clients gehen und Nachricht schicken
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

    //Wenn wir noch nicht beim letzten Video vorbei sind
    if (data["position"] < data["files"].length) {

        //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
        updatePlaylistTimes();

        //Zeit und Status kurzzeitig nicht mehr pruefen, damit Video nicht mehrfach weitergeschaltet wird
        clearInterval(timeAndStatusIntervalID);

        //Position-Infos an Clients schicken
        sendClientInfo(["position"]);

        //Symlink aus aktueller Position in Playlist ermitteln
        let video = symlinkFiles[data["position"]];
        console.log("play video " + video);

        //Optionen fuer neues Video
        let opts = {
            'audioOutput': 'hdmi',
            'blackBackground': true,
            'disableKeys': true,
            'disableOnScreenDisplay': false,
            'disableGhostbox': true,
            'startAt': 0,
            'startVolume': (data["volume"] / 100) //0.0 ... 1.0 default: 1.0
        };

        //Video starten
        omxp.open(video, opts);

        //Aktion mit leichter Verzoegerung ausfuehren (damit Video von ggf. langsamen USB-Stick schnell genug gestartet werden kann)
        //Regelmaessig pruefen wo wir im Video sind und ob das Video noch laueft (=> automatisch weiter in der Playlist gehen, falls Video fertig)
        setTimeout(() => {
            timeAndStatusIntervalID = setInterval(getPos, 1000);
        }, 2000);
    }

    //Playlist ist vorbei
    else {
        console.log("playlist over");

        //Zeit und Status nicht mehr pruefen, da die Playlist vorbei ist
        clearInterval(timeAndStatusIntervalID);

        //Countdown fuer Shutdown zuruecksetzen und starten, weil gerade nichts mehr passiert
        countdownID = setInterval(countdown, 1000);

        //Position zuruecksetzen
        data["position"] = -1;

        //Files zuruecksetzen
        data["files"] = [];

        //Symlink files zuruecksetzen
        symlinkFiles = [];

        //Symlink Verzeichnis leeren
        fs.emptyDirSync(symlinkDir);

        //Clients informieren, dass Playlist fertig ist (position 0)
        sendClientInfo(["position, files"]);
    }
}

//Bei Inaktivitaet Countdown runterzaehlen und Shutdown ausfuehren
function countdown() {
    //console.log("inactive");

    //Wenn der Countdown noch nicht abgelaufen ist
    if (data["countdownTime"] >= 0) {
        //console.log("shutdown in " + data["countdownTime"] + " seconds");

        //Anzahl der Sekunden bis Countdown an Clients schicken
        sendClientInfo(["countdownTime"]);

        //Zeit runterzaehlen
        data["countdownTime"]--;
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
    sendClientInfo(["shutdown"]);

    //TV ausschalten
    execSync("echo standby 0 | cec-client -s -d 1");

    //Pi herunterfahren
    execSync("shutdown -h now");
}

//Position in Video ermitteln
function getPos() {

    //Playing, Paused, undefined
    omxp.getStatus(function (err, status) {
        console.log(status)

        //Wenn gerade kein Video laueft, ist das aktuelle Video fertig
        if (status === undefined) {
            console.log("video over, go to next video");

            //zum naechsten Titel in der Playlist gehen
            data["position"] += 1;

            //Video starten
            startVideo();
        }
    });

    //Position anfordern
    omxp.getPosition(function (err, trackSecondsFloat) {

        //Wenn Video laeuft
        if (trackSecondsFloat) {

            //Umrechnung zu Sek: 134368 => 13 Sek
            let trackSeconds = Math.trunc(trackSecondsFloat / 1000000);

            //data["time"] merken (fuer seek mit setPosition)
            data["time"] = trackSeconds;
            console.log('track progress is', trackSeconds);

            //Restzeit des aktuellen Tracks berechnen
            let trackSecondsRemaining = trackTotalTime - trackSeconds;

            //Timelite String errechnen fuer verbleibende Zeit des Tracks
            data["fileTime"] = generateTimeliteStringFromSeconds(trackSecondsRemaining);

            //jetzt berechnen wie lange die gesamte Playlist noch laeuft: Restzeit des aktuellen Tracks + Summe der Gesamtlaenge der folgenden Tracks
            data["filesTotalTime"] = timelite.time.str(timelite.time.add([data["fileTime"], followingTracksTimeString]));

            //Clients ueber aktuelle Zeiten informieren
            sendClientInfo(["fileTime", "filesTotalTime"]);
        }
    });
}

//Merken wie lange der aktuelle Track geht und ausrechnen wie lange die noch folgenden Tracks der Playlist dauern
function updatePlaylistTimes() {

    //Zeit zuruecksetzen
    trackTotalTime = 0;

    //Sofern die Playlist laueft
    if (data["position"] > -1) {

        //die Anzahl der Sekunden der aktuellen Datei berechnen und merken
        let file = data["files"][data["position"]]["length"];
        trackTotalTime = parseInt(file.substring(0, 2)) * 3600 + parseInt(file.substring(3, 5)) * 60 + parseInt(file.substring(6, 8));
    }

    //Laenge der Files aufsummieren, die nach aktueller Position kommen
    followingTracksTimeString = timelite.time.str(timelite.time.add(
        data["files"]
            .filter((file, pos) => pos > data["position"])
            .map(file => file["length"])));
}

//Aus Sekundenzahl Timelite Array [h, m, s] bauen
function generateTimeliteStringFromSeconds(secondsTotal) {

    //Variablen setzen, falls noch kein sinnvoller Wert geliefert wird
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    //Wenn OMX sinnvolle Werte liefern, Umrechung der Sekunden in [h, m, s] fuer formattierte Darstellung
    if (secondsTotal > 0) {
        hours = Math.floor(secondsTotal / 3600);
        secondsTotal %= 3600;
        minutes = Math.floor(secondsTotal / 60);
        seconds = secondsTotal % 60;
    }

    //h, m, s-Werte in Array packen
    return timelite.time.str([hours, minutes, seconds]);
}

//Playlist zuruecksetzen (z.B. bei Stop oder wenn Playlist zu Ende gelaufen ist)
function resetPlaylist() {

    //Files zuruecksetzen
    data["files"] = [];

    //Symlink files zuruecksetzen
    symlinkFiles = [];

    //Symlink Verzeichnis leeren
    fs.emptyDirSync(symlinkDir);
}