//WebSocketServer anlegen
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Filesystem und Path Abfragen fuer Playlist
const fs = require('fs');
var path = require('path');

//Befehle auf Kommandzeile ausfuehren
const { execSync } = require('child_process');

//Timer benachrichtigt in regelmaesigen Abstaenden ueber Aenderung z.B. Zeit
timerID = null;

//Aktuellen Song / Volume / MuteStatus / Song innerhalb der Playlist / Playlist / PausedStatus / Random merken, damit Clients, die sich spaeter anmelden, diese Info bekommen
currentSong = null;
currentVolume = 100;
currentMute = false;
currentPosition = 0;
currentPlaylist = [];
currentPaused = false;
currentRandom = false;

//Wenn sich ein WebSocket mit dem WebSocketServer verbindet
wss.on('connection', function connection(ws) {
    console.log("new client connected");

    //Timer starten, falls er nicht laeuft
    if (!timerID) {
        startTimer();
    }

    //Wenn WebSocket eine Nachricht sendet
    ws.on('message', function incoming(message) {

        //Nachricht kommt als String -> in JSON Objekt konvertieren
        var obj = JSON.parse(message);
        console.log(obj)

        //Werte auslesen
        let type = obj.type;
        let value = obj.value;

        //Array von MessageObjekte erstellen, die an WS gesendet werden
        let messageObjArr = [{
            type: type,
            value: value
        }];

        //Pro Typ gewisse Aktionen durchfuehren
        switch (type) {

            //neue Playlist laden
            case "set-playlist":
                console.log("set playlist " + value);

                //alte Playlist zuruecksetzen
                currentPlaylist = [];

                //Ueber Dateien in gewuenschtem Verzeichnis gehen
                fs.readdirSync(value).forEach(file => {

                    //mp3 files
                    if (path.extname(file).toLowerCase() === ".mp3") {

                        //In die Playlist laden
                        currentPlaylist.push(value + "/" + file)
                    }
                });

                //Mocp Playlist leeren, neu befuellen und starten
                execSync('mocp --clear');
                execSync('mocp -a ' + value);
                execSync('mocp --play');

                //Liste des Dateinamen an Clients zurueckliefern (nicht nur den dirname)
                messageObjArr[0]["value"] = currentPlaylist;
                break;

            //Song wurde vom Nutzer weitergeschaltet
            case 'change-song':
                console.log("change-song " + value);

                //wenn der naechste Song kommen soll
                if (value) {

                    //Wenn wir noch nicht beim letzten Titel sind
                    if (currentPosition < (currentPlaylist.length - 1)) {

                        //zum naechsten Titel springen
                        execSync('mocp --next');
                    }

                    //wir sind beim letzten Titel
                    else {
                        console.log("kein next beim letzten Track");
                    }
                }

                //der vorherige Titel soll kommen
                else {

                    //Wenn wir nicht beim 1. Titel sind
                    if (currentPosition > 0) {

                        //zum vorherigen Titel springen
                        execSync('mocp --previous');
                    }

                    //wir sind beim 1. Titel
                    else {
                        console.log("1. Titel von vorne");

                        //Playlist nochmal von vorne starten
                        execSync('mocp --play');
                    }
                }

                //Es ist nicht mehr pausiert
                currentPaused = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr gemutet ist
                messageObjArr.push({
                    type: "set-paused",
                    value: currentPaused
                })

                break;

            //Song hat sich geandert
            case 'song-change':

                //neue Song merken und Positoin in Playlist merken
                currentSong = value;
                currentPosition = currentPlaylist.indexOf(value);
                console.log("new song " + value + " has position " + (currentPosition));

                //Zusaetzliche Nachricht an clients, welche Position der Titel hat
                messageObjArr.push({
                    type: "set-position",
                    value: (currentPosition)
                });
                break;

            //Playback wurde beendet
            case 'stop':
                console.log("STOPPED")
                break;

            //Lautstaerke setzen
            case 'set-volume':

                //neue Lautstaerke merken 
                currentVolume = value;

                //Mute (ggf.) entfernen und Lautstaerke setzen
                let volumeCommand = "sudo amixer sset PCM on && sudo amixer sset PCM " + value + "% -M";
                console.log(volumeCommand)
                execSync(volumeCommand);

                //Mute entfernen
                currentMute = false;

                //Zusaetzliche Nachricht an clients, dass nun nicht mehr gemutet ist
                messageObjArr.push({
                    type: "set-mute",
                    value: currentMute
                });
                break;

            //Mute-Status setzen
            case 'set-mute':

                //neuen Mutestatus merken 
                currentMute = value;

                //Mute fuer Mixer ermitteln
                muteState = value ? "off" : "on";

                //Mute setzen
                let muteCommand = "sudo amixer sset PCM " + muteState;
                console.log(muteCommand)
                execSync(muteCommand);
                break;

            //Pause-Status setzen
            case 'set-paused':

                //neuen Pausedstatus merken 
                currentPaused = value;

                //Wenn pausiert werden soll
                if (value) {
                    execSync("mocp --pause");
                }

                //es ist pausiert und soll wieder gestartet werden
                else {
                    execSync("mocp --unpause");
                }
                break;

            //Random setzen
            case 'set-random':

                break;
        }

        //Ueber Liste der MessageObjs gehen und an WS senden
        for (ws of wss.clients) {
            for (messageObj of messageObjArr)
                try {
                    ws.send(JSON.stringify(messageObj));
                }
                catch (e) { }
        }
    });

    //WS (einmalig beim Verbinden) ueber aktuellen Titel informieren
    ws.send(JSON.stringify({
        type: "song-change",
        value: currentSong
    }));

    //WS (einmalig beim Verbinden) ueber aktuelles Volume informieren
    ws.send(JSON.stringify({
        type: "set-volume",
        value: currentVolume
    }));

    //WS (einmalig beim Verbinden) ueber aktuellen Mutezustand informieren
    ws.send(JSON.stringify({
        type: "set-mute",
        value: currentMute
    }));

    //WS (einmalig beim Verbinden) ueber aktuellen Position informieren
    ws.send(JSON.stringify({
        type: "set-position",
        value: currentPosition
    }));

    //WS (einmalig beim Verbinden) ueber aktuelle Playlist informieren
    ws.send(JSON.stringify({
        type: "set-playlist",
        value: currentPlaylist
    }));

    //WS (einmalig beim Verbinden) ueber aktuellen PausedStatus informieren
    ws.send(JSON.stringify({
        type: "set-paused",
        value: currentPaused
    }));
});

//Timer-Funktion benachrichtigt regelmaessig die WS
function startTimer() {
    console.log("startTimer")

    //TimerID, damit Timer zurueckgesetzt werden kann
    timerID = setInterval(() => {
        //console.log("Send to " + wss.clients.length + " clients")

        //Wenn es keine Clients gibt
        if (wss.clients.length == 0) {
            console.log("No more clients for Timer")

            //Timer zuruecksetzen
            clearInterval(timerID);
            timerID = null;
        }

        //Zeitpunkt in Titel
        let time = "";

        //Versuchen aktuelle Zeit in Titel ermitteln
        try {
            time = execSync('mocp -Q %ct');
            console.log(time.toString().trim())
        }
        catch (e) { }

        //MessageObj erstellen
        let messageObj = {
            type: "time",
            value: time.toString().trim()
        };

        //MessageObj an WS senden
        for (ws of wss.clients) {
            try {
                ws.send(JSON.stringify(messageObj));
            }
            catch { }
        }
    }, 1000)
}