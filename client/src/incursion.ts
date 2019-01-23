import * as ESI from './esiDefinitions';

class ESIData {
    db: IDBDatabase;
    constructor(db: IDBDatabase) {
        this.db = db;
    }
    private checkCache(storeName: string, key: number): Promise<any> {
        let objectStore = this.db
            .transaction(storeName, 'readonly')
            .objectStore(storeName);
        let request = objectStore.get(key);
        return new Promise((resolve, reject) => {
            request.onsuccess = event => {
                resolve(request.result);
            };
            request.onerror = event => {
                reject(event);
            };
        });
    }
    private async fetchJSON(route: string, fields?: Array<Array<string>>) {
        fields = fields || [];
        fields.push(['datasource', 'tranquility']);
        let queryString = new URLSearchParams(fields);
        let response = await fetch(
            `https://esi.evetech.net/latest/${route}/?${queryString}`
        );
        return await response.json();
    }
    async incursionData(): Promise<Array<ESI.Incursion>> {
        return await this.fetchJSON('incursions');
    }
    async constellationData(
        constellationID: number
    ): Promise<ESI.Constellation> {
        let constellationCache = await this.checkCache(
            'constellation',
            constellationID
        );
        if (constellationCache) {
            return constellationCache;
        } else {
            let constellationJSON = await this.fetchJSON(
                `universe/constellations/${constellationID}`
            );
            let constellationStore = this.db
                .transaction('constellation', 'readwrite')
                .objectStore('constellation');
            constellationStore.put(constellationJSON);
            return constellationJSON;
        }
    }
}

class IncursionDisplay {
    private data: ESIData;
    constructor(data: ESIData) {
        this.data = data;
    }
    constellation(constellationID: number) {
        let constellatioName = document.createTextNode(`${constellationID}`);
        this.data
            .constellationData(constellationID)
            .then(
                constellation =>
                    (constellatioName.nodeValue = `${constellation.name}`)
            );
        return constellatioName;
    }
}

function main() {
    let openDatabase = window.indexedDB.open('incursion');
    openDatabase.onerror = event => {
        document.body.appendChild(
            document.createTextNode('Failed to connect to database cache.')
        );
    };
    openDatabase.onsuccess = async event => {
        let esiAPI = new ESIData(openDatabase.result);
        let renderer = new IncursionDisplay(esiAPI);
        let incursionData = await esiAPI.incursionData();
        incursionData.forEach(async incursion => {
            let display = document.createElement('section');
            display.appendChild(
                renderer.constellation(incursion.constellation_id)
            );
            document.body.appendChild(display);
        });
    };
    openDatabase.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        let db = openDatabase.result;
        let constellationStore = db.createObjectStore('constellation', {
            keyPath: 'constellation_id'
        });
        constellationStore.createIndex('constellation_id', 'constellation_id', {
            unique: true
        });
    };
}
(function() {
    let mainRan = false;
    if (document.readyState != 'loading') {
        mainRan && main();
        mainRan = true;
    } else {
        document.addEventListener('readystatechange', () => {
            if (document.readyState != 'loading') {
                mainRan && main();
                mainRan = true;
            }
        });
    }
})();
