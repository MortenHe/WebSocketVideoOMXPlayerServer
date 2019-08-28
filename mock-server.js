//WebSocketServer anlegen und starten
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080, clientTracking: true });

//Zeit Formattierung laden: [5, 13, 22] => 05:13:22
const timelite = require('timelite');

//Zeit wie lange bis Shutdown durchgefuhert wird bei Inaktivitaet
const countdownTime = 180;

//Elemente in Playlist verschieben
const arrayMove = require('array-move');

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

//Mock Sekunden werden hochgezaehlt um Videowiedergabe zu emulieren
const mockTrackLength = 50;
const mockTrackLengthString = "00:10:50";
var mockSeconds = 0;

//Anzahl der Sekunden des aktuellen Tracks
var trackTotalTime = 0;

//Summe der h, m, s der Dateien, die Playlist nach aktueller Position kommen
var followingTracksTimeString = "00:00:00";

//Countdown fuer Shutdown starten, weil gerade nichts passiert
var countdownID = setInterval(countdown, 1000);

//Wenn ein Video laeuft, ermitteln wo wir gerade sind und ob Video noch laueft
var timeAndStatusIntervalID = null;

//Wenn sich ein WebSocket-Client mit dem WebSocketServer verbindet
wss.on('connection', function connection(ws) {
    console.log("new client connected");

    //Wenn Client eine Nachricht an WSS sendet
    ws.on('message', function incoming(message) {

        //Nachricht kommt als String -> in JSON Objekt konvertieren
        const obj = JSON.parse(message);
        const type = obj.type;
        const value = obj.value;

        //Array von MessageObjekte erstellen, die an WS gesendet werden
        const messageArr = [];

        //Pro Typ gewisse Aktionen durchfuehren
        switch (type) {

            //neue Playlist laden (ueber Browser-Aufruf) oder per RFID-Karte
            case "add-to-video-playlist": case "set-rfid-playlist":
                console.log(type + JSON.stringify(value));

                //Countdown fuer Shutdown wieder stoppen, weil nun etwas passiert und Countdowntime zuruecksetzen
                clearInterval(countdownID);
                data["countdownTime"] = countdownTime;

                //Wenn Video gestartet werden soll, bisherige Playlist zuruecksetzen
                if (value.startPlayback) {
                    resetPlaylist();
                }

                //Dateiobjekt sammeln ("Conni back Pizza", "00:13:05", "kinder/conni/conni-backt-pizza.mp4")
                data["files"].push({
                    "file": value.file,
                    "name": value.name,
                    "length": mockTrackLengthString
                });
                console.log("current files:\n" + JSON.stringify(data["files"]));

                //Laengen-Merkmal aus Playlist-Array extrahieren und addieren
                const playlist_length_array = timelite.time.add(data["files"].map(item => item.length));

                //Ergebnis als String: [0, 5, 12] -> "00:05:12" liefern
                data["filesTotalTime"] = timelite.time.str(playlist_length_array);
                console.log("playlist total length: " + data["filesTotalTime"]);

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

            //Titel aus Playlist entfernen
            case 'remove-from-playlist':
                console.log("remove-item " + value);
                data["files"].splice(value, 1);

                //Wenn keine Titel mehr in Playlist sind, Countdown starten
                if (data["files"].length === 0) {
                    countdownID = setInterval(countdown, 1000);
                }

                //Gesamtspielzeit der Playlist anpassen und Clients informieren
                updatePlaylistTimes();
                messageArr.push("files", "filesTotalTime");
                break;

            //Playlist umsortieren und Clients informieren
            case 'sort-playlist':
                console.log("move item " + value.from + " to " + value.to);
                data["files"] = arrayMove(data["files"], value.from, value.to);
                messageArr.push("files");
                break;

            //Sprung zu einem bestimmten Video in Playlist
            case "jump-to":

                //Wie viele Schritte in welche Richtung springen?
                const jumpTo = value - data["position"];
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
                messageArr.push("volume");
                break;

            //Pause-Status toggeln
            case 'toggle-play-pause':

                //Pausenstatus toggeln und Clients informieren
                data["paused"] = !data["paused"];
                messageArr.push("paused");
                break;

            //Video stoppen
            case "stop":

                //Countdown fuer Shutdown zuruecksetzen und starten, weil gerade nichts mehr passiert
                countdownID = setInterval(countdown, 1000);

                //Zeit und Status nicht mehr pruefen und Mock-Sekunden zuruecksetzen
                clearInterval(timeAndStatusIntervalID);
                mockSeconds = 0;

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
                const offset = value ? 1000 : -1000

                //Neue Position berechnen
                const newPosition = (data["time"] * 100) + offset;

                //Neu (errechnete) Zeit setzen, damit mehrmaliges Spulen funktioniert
                data["time"] = newPosition / 100;
                break;
        }

        //Infos an Clients schicken
        sendClientInfo(messageArr);
    });

    //WS einmalig bei der Verbindung ueber div. Wert informieren
    const WSConnectMessageArr = ["volume", "position", "paused", "files", "filesTotalTime"];

    //Ueber Messages gehen, die an Clients geschickt werden
    WSConnectMessageArr.forEach(message => {

        //Message-Object erzeugen und an Client schicken
        const messageObj = {
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
        const messageObj = {
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
    console.log("play video at " + data["position"]);

    //Wenn wir noch nicht beim letzten Video vorbei sind
    if (data["position"] < data["files"].length) {

        //Zeit anpassen, die die nachfolgenden Videos der Playlist haben und wie lange das aktuelle Video geht
        updatePlaylistTimes();

        //Zeit und Status kurzzeitig nicht mehr pruefen, damit Video nicht mehrfach weitergeschaltet wird
        clearInterval(timeAndStatusIntervalID);

        //Position-Infos an Clients schicken
        sendClientInfo(["position"]);

        //Aktion mit leichter Verzoegerung ausfuehren (damit Video von ggf. langsamen USB-Stick schnell genug gestartet werden kann)
        //Regelmaessig pruefen wo wir im Video sind und ob das Video noch laueft (=> automatisch weiter in der Playlist gehen, falls Video fertig)
        setTimeout(() => {
            timeAndStatusIntervalID = setInterval(getPos, 1000);
        }, 100);
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

        //Playlist zureucksetzen
        resetPlaylist();

        //Clients informieren, dass Playlist fertig ist (position 0)
        sendClientInfo(["position", "files"]);
    }
}

//Bei Inaktivitaet Countdown runterzaehlen und Shutdown ausfuehren
function countdown() {

    //Wenn der Countdown noch nicht abgelaufen ist
    if (data["countdownTime"] >= 0) {

        //Anzahl der Sekunden bis Countdown an Clients schicken
        sendClientInfo(["countdownTime"]);

        //Zeit runterzaehlen
        data["countdownTime"]--;
    }

    //Countdown ist abgelaufen, Server beenden
    else {
        sendClientInfo(["shutdown"]);
        process.exit();
    }
}

//Position in Video ermitteln
function getPos() {

    //Mock-Sekunden hochzaehlen bei emulierter Videowiedergabe
    mockSeconds++;

    //Wenn Video zu Ende ist, 
    if (mockSeconds === mockTrackLength) {
        console.log("video over, go to next video");

        //zum naechsten Video gehen und von vorne starten
        data["position"] += 1;
        mockSeconds = 0;
        startVideo();
    }

    //data["time"] merken (fuer seek mit setPosition)
    data["time"] = mockSeconds;
    console.log('track progress is', mockSeconds);

    //Restzeit des aktuellen Tracks berechnen
    const trackSecondsRemaining = trackTotalTime - mockSeconds;

    //Timelite String errechnen fuer verbleibende Zeit des Tracks
    data["fileTime"] = generateTimeliteStringFromSeconds(trackSecondsRemaining);

    //jetzt berechnen wie lange die gesamte Playlist noch laeuft: Restzeit des aktuellen Tracks + Summe der Gesamtlaenge der folgenden Tracks
    data["filesTotalTime"] = timelite.time.str(timelite.time.add([data["fileTime"], followingTracksTimeString]));

    //Clients ueber aktuelle Zeiten informieren
    sendClientInfo(["fileTime", "filesTotalTime"]);
}

//Merken wie lange der aktuelle Track geht und ausrechnen wie lange die noch folgenden Tracks der Playlist dauern
function updatePlaylistTimes() {

    //Zeit zuruecksetzen
    trackTotalTime = 0;

    //Sofern die Playlist laueft
    if (data["position"] > -1) {

        //die Anzahl der Sekunden der aktuellen Datei berechnen und merken
        const file = data["files"][data["position"]]["length"];
        trackTotalTime = parseInt(file.substring(0, 2)) * 3600 + parseInt(file.substring(3, 5)) * 60 + parseInt(file.substring(6, 8));
    }

    //Laenge der Files aufsummieren, die nach aktueller Position kommen
    followingTracksTimeString = timelite.time.str(timelite.time.add(
        data["files"]
            .filter((file, pos) => pos > data["position"])
            .map(file => file["length"])));

    //Neue Gesamtlauftzeit der Playlist setzen
    data["filesTotalTime"] = followingTracksTimeString;
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
    data["files"] = [];
}