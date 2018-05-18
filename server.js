//Mplayer + Wrapper anlegen
const createPlayer = require('mplayer-wrapper');
const player = createPlayer();

//WebSocketServer anlegen
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Zeit Formattierung laden: [5, 13, 22] => 05:13:22
const timelite = require('timelite');

//lodash laden (padstart)
var _ = require('lodash');

//Aktuelle Infos zu Volume / Position in Song / Position innerhalb der Playlist / Playlist / PausedStatus / Random merken, damit Clients, die sich spaeter anmelden, diese Info bekommen
currentVolume = 100;
currentPosition = 0;
currentFiles = [];
currentPaused = false;
currentRandom = false;
currentAllowRandom = false;

//Wenn bei Track change der Filename geliefert wird
player.on('filename', (filename) => {

    //Position in Playlist ermitteln
    currentPosition = currentFiles.indexOf(currentPlaylist + "/" + filename);

    //Position in Playlist zusammen mit anderen Merkmalen merken fuer den Neustart
    fs.writeJsonSync('./lastSession.json', { path: currentPlaylist, allowRandom: currentAllowRandom, position: currentPosition });

    //Position an Clients senden
    let messageObj = {
        type: "set-position",
        value: currentPosition
    }

    //Ueber Liste der WS gehen und Nachricht schicken
    for (ws of wss.clients) {
        try {
            ws.send(JSON.stringify(messageObj));
        }
        catch (e) { }
    }
});

//Wenn Laenge des Tracks bei Track change geliefert wird
player.on('length', function (val) {
    console.log("Laenge ist " + val);
});

//Wenn sich ein Titel aendert (durch Nutzer oder durch den Player)
player.on('track-change', () => {

    //Neuen Dateinamen liefern
    player.getProps(['filename']);

    //Laenge des Titels liefern
    player.getProps(['length']);
});

//Filesystem und Path Abfragen fuer Playlist
const path = require('path');
const fs = require('fs-extra');

//Array Shuffle Funktion
var shuffle = require('shuffle-array');

//Befehle auf Kommandzeile ausfuehren
const { execSync } = require('child_process');

//Je nach Ausfuerung auf pi oder in virtualbox gibt es unterschiedliche Pfade, Mode wird ueber command line uebergeben: node server.js vb
const mode = process.argv[2] ? process.argv[2] : "pi";

//Wert fuer Pfad aus config.json auslesen
const configObj = fs.readJsonSync('./config.json');

//Verzeichnis in dem die playlist.txt hinterlegt wird
const progDir = configObj["path"][mode]["progDir"];

//Nachrichten an die Clients
var messageObjArr = [];

//Infos aus letzter Session auslesen
try {

    //JSON-Objekt aus Datei holen
    const lastSessionObj = fs.readJsonSync('./lastSession.json');

    //Playlist-Pfad laden
    currentPlaylist = lastSessionObj.path;

    //Laden, ob Randon erlaubt ist
    currentAllowRandom = lastSessionObj.allowRandom;

    //letzte Position in Playlist laden
    currentPosition = lastSessionObj.position;
}

//wenn lastSession.json noch nicht existiert
catch (e) {

    //keine Playlist laden
    currentPlaylist = "";
}

//Wenn eine Playlist aus der vorherigen Session geladen wurde
if (currentPlaylist) {
    console.log("Load playlist from last session " + currentPlaylist);

    //diese Playlist zu Beginn spielen
    setPlaylist(true);
}

//TimeFunktion starten, die aktuelle Laufzeit des Titels liefert
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
        messageObjArr = [{
            type: type,
            value: value
        }];

        //Pro Typ gewisse Aktionen durchfuehren
        switch (type) {

            //neue Playlist laden (ueber Browser-Aufruf)
            case "set-playlist":
                console.log("set playlist " + value);

                //Audio-Verzeichnis merken
                currentPlaylist = value.dir;

                //Merken ob Random erlaubt ist
                currentAllowRandom = value.allowRandom;

                //Playlist und allowRandom in Datei merken fuer Neustart
                fs.writeJsonSync('./lastSession.json', { path: currentPlaylist, allowRandom: currentAllowRandom, position: currentPosition });

                //Setlist erstellen und starten
                setPlaylist(false);

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });

                //Info nicht an clients schicken?
                break;

            //Videoplaylist erstellen
            case "set-video-playlist":

                //Videos werden als Symlinks immer im gleichen Verzeichnis abgelegt
                currentPlaylist = progDir + "/videoSym";

                //Symlink verzeichnis leeren
                fs.emptyDirSync(currentPlaylist);

                //Ueber Videos gehen ([bebl/bebl-bananendieb.mp4, bibi-tina/bibi-tina-sabrinas-fohlen.mp4)
                value.forEach((videoObj, index) => {

                    //Wo liegt Datei?
                    let sourcePath = "/media/usb_red/video/" + videoObj.mode + "/" + videoObj.path;

                    //Symlink in gemeinsamen Verzeichnis
                    let destPath = progDir + "/videoSym/" + _.padStart(index + 1, 2, "0") + " - " + videoObj.name + ".mp4";

                    //Symlink erstellen, aus dem dann die Playlist generiert wird
                    fs.ensureSymlinkSync(sourcePath, destPath);
                });

                //Bei Video derzeit kein Random
                currentAllowRandom = false;

                //Playlist und allowRandom in Datei merken fuer Neustart
                fs.writeJsonSync('./lastSession.json', { path: currentPlaylist, allowRandom: currentAllowRandom, position: currentPosition });

                //Setlist erstellen und starten
                setPlaylist(false);

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });
                break;


            //neue Setlist laden (per RFID-Karte)
            case "set-rfid-playlist":

                //Audio-Verzeichnis merken
                currentPlaylist = "/media/usb_red/audio/" + configObj["cards"][value]["path"];

                //allowRandom merken
                currentAllowRandom = configObj["cards"][value]["allowRandom"];

                //Playlist und allowRandom in Datei merken fuer Neustart
                fs.writeJsonSync('./lastSession.json', { path: currentPlaylist, allowRandom: currentAllowRandom, position: currentPosition });

                //Setlist erstellen und starten
                setPlaylist(false);

                //Playlist Dir an Clients liefern
                messageObjArr[0].value = currentPlaylist;

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });

                //TODO clients nicht ueber Wert informieren
                break;

            //Song wurde vom Nutzer weitergeschaltet
            case 'change-song':
                console.log("change-song " + value);

                //wenn der naechste Song kommen soll
                if (value) {

                    //Wenn wir noch nicht beim letzten Titel sind
                    if (currentPosition < (currentFiles.length - 1)) {

                        //zum naechsten Titel springen
                        player.next();
                    }

                    //wir sind beim letzten Titel
                    else {

                        //Wenn Titel pausiert war, wieder unpausen
                        if (currentPaused) {
                            player.playPause();
                        }
                        console.log("kein next beim letzten Track");
                    }
                }

                //der vorherige Titel soll kommen
                else {

                    //Wenn wir nicht beim 1. Titel sind
                    if (currentPosition > 0) {

                        //zum vorherigen Titel springen
                        player.previous();
                    }

                    //wir sind beim 1. Titel
                    else {

                        //Playlist nochmal von vorne starten
                        player.seekPercent(0);
                        console.log("1. Titel von vorne");

                        //Wenn Titel pausiert war, wieder unpausen
                        if (currentPaused) {
                            player.playPause();
                        }
                    }
                }

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });

                //TODO clients nicht ueber increase:boolean informieren
                break;

            //Sprung zu einem bestimmten Titel in Playlist
            case "jump-to":

                //Wie viele Schritte in welche Richtung springen?
                let jumpTo = value - currentPosition;
                console.log("jump-to " + jumpTo);

                //zu gewissem Titel springen
                player.exec("pt_step " + jumpTo);

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr pausiert ist
                messageObjArr.push({
                    type: "toggle-paused",
                    value: currentPaused
                });

                //TODO nicht an Clients senden?
                break;

            //Lautstaerke aendern
            case 'change-volume':

                //Wenn lauter werden soll, max. 100 setzen
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

                //Geaenderten Wert an Clients schicken
                messageObjArr[0].value = currentVolume;
                break;

            //Lautstaerke setzen
            case 'set-volume':

                //neue Lautstaerke merken 
                currentVolume = value;

                //Lautstaerke setzen
                let setVolumeCommand = "sudo amixer sset PCM " + value + "% -M";
                console.log(setVolumeCommand)
                execSync(setVolumeCommand);
                break;

            //Pause-Status toggeln
            case 'toggle-paused':

                //Pausenstatus toggeln
                currentPaused = !currentPaused;

                //Pause toggeln
                player.playPause();

                //Geaenderten Wert an Clients schicken
                messageObjArr[0].value = currentPaused;
                break;

            //Random toggle
            case 'toggle-random':

                //Random-Wert togglen
                currentRandom = !currentRandom;

                //Wenn random erlaubt ist
                if (currentAllowRandom) {

                    //Playlist mit neuem Random-Wert neu laden
                    setPlaylist();
                }

                //Geanderten Wert an Clients schicken
                messageObjArr[0].value = currentRandom;
                break;

            //Innerhalb des Titels spulen
            case "seek":

                //+/- 10 Sek
                let seekTo = value ? 10 : -10;

                //seek in item
                player.seek(seekTo);

                //TODO nicht per MessageObj schicken?
                break;
        }

        //Ueber Liste der MessageObjs gehen und Nachrichten an WS senden
        for (ws of wss.clients) {
            for (messageObj of messageObjArr)
                try {
                    ws.send(JSON.stringify(messageObj));
                }
                catch (e) { }
        }
    });

    //WS (einmalig beim Verbinden) ueber aktuelles Volume informieren
    ws.send(JSON.stringify({
        type: "set-volume",
        value: currentVolume
    }));

    //WS (einmalig beim Verbinden) ueber aktuellen Position informieren
    ws.send(JSON.stringify({
        type: "set-position",
        value: currentPosition
    }));

    //WS (einmalig beim Verbinden) ueber aktuellen PausedStatus informieren
    ws.send(JSON.stringify({
        type: "toggle-paused",
        value: currentPaused
    }));

    //WS (einmalig beim Verbinden) ueber aktuelle Filelist informieren
    ws.send(JSON.stringify({
        type: "set-files",
        value: currentFiles
    }));

    //WS (einmalig beim Verbinden) ueber aktuellen RandomState informieren
    ws.send(JSON.stringify({
        type: "toggle-random",
        value: currentRandom
    }));
});

//Timer-Funktion benachrichtigt regelmaessig die WS ueber aktuelle Position des Tracks
function startTimer() {
    console.log("startTimer");

    //Wenn time_pos property geliefert wirde
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
        let messageObj = {
            type: "time",
            value: outputString
        };

        //Time-MessageObj an WS senden
        for (ws of wss.clients) {
            try {
                ws.send(JSON.stringify(messageObj));
            }
            catch (e) { }
        }
    });

    //Jede Sekunde die aktuelle Zeit innerhalb des Tracks liefern
    setInterval(() => {
        player.getProps(['time_pos']);
    }, 1000);
}

//Playlist erstellen und starten
function setPlaylist(reloadSession) {

    //Liste der files zuruecksetzen
    currentFiles = [];

    //Ueber Dateien in aktuellem Verzeichnis gehen
    fs.readdirSync(currentPlaylist).forEach(file => {

        //mp4 (video) und mp3 (audio) files sammeln
        if ([".mp4", ".mp3"].includes(path.extname(file).toLowerCase())) {
            console.log("add file " + file);
            currentFiles.push(currentPlaylist + "/" + file);
        }
    });

    //Bei Random und erlaubtem Random
    if (currentRandom && currentAllowRandom) {

        //FileArray shuffeln
        shuffle(currentFiles);
    }

    //Playlist-Datei schreiben (1 Zeile pro item)
    fs.writeFileSync(progDir + "/playlist.txt", currentFiles.join("\n"));

    //Playlist-Datei laden und starten
    player.exec("loadlist " + progDir + "/playlist.txt");

    //Liste des Dateinamen an Clients liefern
    messageObjArr.push({
        type: "set-files",
        value: currentFiles
    });

    //Wenn die Daten aus einer alten Session kommen
    if (reloadSession) {

        //zu gewissem Titel springen, wenn nicht sowieso der erste Titel
        if (currentPosition > 0) {
            player.exec("pt_step " + currentPosition);
        }
    }
}