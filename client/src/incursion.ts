import * as ESI from './esiDefinitions';
import { SSL_OP_EPHEMERAL_RSA } from 'constants';

const securityColors = Object.freeze([
    '#F00000',
    '#D73000',
    '#F04800',
    '#F06000',
    '#D77700',
    '#EFEF00',
    '#8FEF2F',
    '#00F000',
    '#00EF47',
    '#48F0C0',
    '#2FEFEF'
]);

function fromEntries(iterable: any[]) {
    return [...iterable].reduce(
        (obj, [key, value]) => Object.assign(obj, { [key]: value }),
        {}
    );
}

class ESIData {
    db: IDBDatabase;
    cacheExpireDate: Date;
    constructor(db: IDBDatabase) {
        this.db = db;
        let today = new Date();
        today.setMonth(today.getDate() - 30);
        this.cacheExpireDate = today;
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
        if (
            constellationCache &&
            constellationCache.date > this.cacheExpireDate
        ) {
            return constellationCache;
        } else {
            let constellationJSON = await this.fetchJSON(
                `universe/constellations/${constellationID}`
            );
            let constellationStore = this.db
                .transaction('constellation', 'readwrite')
                .objectStore('constellation');
            constellationJSON.date = new Date();
            constellationStore.put(constellationJSON);
            return constellationJSON;
        }
    }
    async regionData(regionID: number): Promise<ESI.Region> {
        let regionCache = await this.checkCache('region', regionID);
        if (regionCache && regionCache.date > this.cacheExpireDate) {
            return regionCache;
        } else {
            let regionJSON = await this.fetchJSON(
                `universe/regions/${regionID}`
            );
            regionJSON.date = new Date();
            let regionStore = this.db
                .transaction('region', 'readwrite')
                .objectStore('region');
            regionStore.put(regionJSON);
            return regionJSON;
        }
    }
    async systemData(systemID: number): Promise<ESI.System> {
        // Consider adding casts for checkCache calls
        let systemCache = await this.checkCache('system', systemID);
        if (systemCache && systemCache.date > this.cacheExpireDate) {
            return systemCache;
        } else {
            let systemJSON = await this.fetchJSON(
                `universe/systems/${systemID}`
            );
            let systemStore = this.db
                .transaction('system', 'readwrite')
                .objectStore('system');
            systemJSON.date = new Date();
            systemStore.put(systemJSON);
            return systemJSON;
        }
    }
    async systemGates(systemID: number): Promise<Record<number, ESI.Stargate>> {
        let systemData = await this.systemData(systemID);
        if (systemData.stargates) {
            let stargateData = fromEntries(
                await Promise.all(
                    systemData.stargates.map(async stargateID => [
                        stargateID,
                        await this.universeData('stargate', stargateID)
                    ])
                )
            );
            return stargateData;
        } else {
            return {};
        }
    }
    async systemRadius(systemID: number): Promise<number> {
        const system = await this.systemData(systemID);
        if (
            system.hasOwnProperty('radius') &&
            typeof system.radius == 'number'
        ) {
            return system.radius;
        }
        let asteroid_belt =
            system.planets &&
            system.planets
                .map(({ asteroid_belts }) => asteroid_belts)
                .filter(moons => moons)
                .reduce(
                    (belts, newBelts) => (belts || []).concat(newBelts || []),
                    []
                );
        let moon =
            system.planets && system.planets.map(({ planet_id }) => planet_id);
        let celestialData: { [s: string]: number[] } = {
            ...(asteroid_belt && { asteroid_belt }),
            ...(moon && { moon }),
            ...(system.planets && {
                planet: system.planets.map(({ planet_id }) => planet_id)
            }),
            ...(system.stargates && { stargate: system.stargates }),
            ...(system.stations && { station: system.stations })
        };
        let positionData: ESI.Positioned[] = await Promise.all(
            Object.entries(celestialData)
                .map(([celestialType, celestials]) =>
                    celestials.map((celesitalID: number) =>
                        this.universeData(celestialType, celesitalID)
                    )
                )
                .reduce((bucket, more) => bucket.concat(more), [])
        );
        let distances = positionData.map(
            ({ position: { x, y, z } }) =>
                Math.sqrt(x * x + y * y + z * z) / 149597870700
        );
        let maxDistance = Math.max(...distances);
        let systemStore = this.db
            .transaction('system', 'readwrite')
            .objectStore('system');
        system.radius = maxDistance;
        systemStore.put(system);
        return maxDistance;
    }
    private async universeData(
        type: string,
        id: number
    ): Promise<ESI.Positioned> {
        let cachedData = await this.checkCache(type, id);
        if (cachedData && cachedData.date > this.cacheExpireDate) {
            return cachedData;
        } else {
            let universeJSON = await this.fetchJSON(`universe/${type}s/${id}`);
            universeJSON.date = new Date();
            if (type == 'asteroid_belt') {
                universeJSON.asteroidBeltID = id;
            }
            let store = this.db
                .transaction(type, 'readwrite')
                .objectStore(type);
            store.put(universeJSON);
            return universeJSON;
        }
    }
}

class IncursionDisplay {
    private data: ESIData;
    constructor(data: ESIData) {
        this.data = data;
    }
    constellation(constellationID: number, regionID: number) {
        const constellationElement = document.createElement('a');
        const constellationName = document.createTextNode(`${constellationID}`);
        constellationElement.appendChild(constellationName);
        this.data.constellationData(constellationID).then(constellation => {
            constellationName.nodeValue = `${constellation.name}`;
            this.data
                .regionData(constellation.region_id)
                .then(
                    ({ name }) =>
                        (constellationElement.href = `https://evemaps.dotlan.net/map/${name}/${
                            constellation.name
                        }`)
                );
        });
        return constellationElement;
    }
    state(state: string) {
        return new Text(
            'State: ' + state.charAt(0).toUpperCase() + state.slice(1)
        );
    }
    system(systemID: number) {
        const systemLink = document.createElement('a');
        let systemName = new Text(`${systemID}`);
        this.data.systemData(systemID).then(system => {
            this.data.systemData(systemID).then(system => {
                let temp = new Text(`${system.name}`);
                systemName.replaceWith(temp);
                systemName = temp;
                systemLink.href = `https://evemaps.dotlan.net/system/${
                    system.name
                }`;
            });
        });
        systemLink.appendChild(systemName);
        return systemLink;
    }
    systemSecurity(systemID: number) {
        let security = document.createElement('span');
        this.data.systemData(systemID).then(({ security_status }) => {
            security.appendChild(new Text(`${security_status.toFixed(1)}`));
            if (security_status < 0) {
                security_status = 0;
            }
            security.style.color =
                securityColors[Math.round(security_status * 10)];
        });
        return security;
    }
    systemRadius(systemID: number) {
        const radiusDisplay = document.createElement('span');
        let radiusText = new Text('? AU');
        radiusDisplay.appendChild(radiusText);
        this.data.systemRadius(systemID).then(radius => {
            const temp = new Text(`${radius.toFixed(1)} AU`);
            radiusText.replaceWith(temp);
            radiusText = temp;
        });
        return radiusDisplay;
    }
    systemRow(systemID: number, staging_solar_system_id: number) {
        const row = document.createElement('tr');
        [this.system, this.systemSecurity, this.systemRadius].forEach(
            column => {
                const td = document.createElement('td');
                td.appendChild(column.apply(this, [systemID]));
                row.appendChild(td);
            }
        );
        return row;
    }
    superCarrierIcon() {
        const icon = document.createElement('canvas');
        icon.width = 32;
        icon.height = 32;
        const ctx = icon.getContext('2d');
        if (!ctx) {
            return document.createTextNode('Boss');
        }
        ctx.scale(2, 2);
        ctx.translate(8, 8);
        ctx.rotate((45 * Math.PI) / 180);
        ctx.translate(-8, -8);
        ctx.fillStyle = '#7d0808';
        ctx.fillRect(3, 3, 7, 7);
        ctx.strokeStyle = '#d63333';
        ctx.strokeRect(3, 3, 7, 7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(12, 4);
        ctx.lineTo(12, 12);
        ctx.lineTo(4, 12);
        ctx.stroke();
        return icon;
    }
}

function main() {
    let openDatabase = window.indexedDB.open('incursion');
    openDatabase.onerror = event => {
        document.body.appendChild(
            document.createTextNode('Failed to connect to cache database.')
        );
    };
    openDatabase.onsuccess = async event => {
        let incursions = document.createElement('main');
        let esiAPI = new ESIData(openDatabase.result);
        let renderer = new IncursionDisplay(esiAPI);
        let incursionData = await esiAPI.incursionData();
        let sortIncursions: Function[] = [];
        incursionData.forEach(async incursion => {
            let display = document.createElement('section');

            let constellationName = document.createElement('h1');
            constellationName.appendChild(
                renderer.constellation(incursion.constellation_id)
            );
            if (incursion.has_boss) {
                constellationName.appendChild(renderer.superCarrierIcon());
            }
            display.appendChild(constellationName);

            const state = document.createElement('div');
            state.appendChild(renderer.state(incursion.state));
            display.appendChild(state);

            let influence = document.createElement('div');
            influence.appendChild(
                document.createTextNode(
                    `Influence: ${((1 - incursion.influence) * 100).toFixed(
                        1
                    )}% effective`
                )
            );
            display.appendChild(influence);

            let staging = document.createElement('div');
            staging.appendChild(document.createTextNode('Staging system: '));
            staging.appendChild(
                renderer.system(incursion.staging_solar_system_id)
            );
            staging.appendChild(new Text(' ('));
            staging.appendChild(
                renderer.systemSecurity(incursion.staging_solar_system_id)
            );
            staging.appendChild(new Text(')'));
            display.appendChild(staging);

            let sortSystems: Function[] = [];
            let affectedSystems = document.createElement('table');
            let affectedSystemsBody = document.createElement('tbody');
            incursion.infested_solar_systems.forEach(systemID => {
                const row = renderer.systemRow(
                    systemID,
                    incursion.staging_solar_system_id
                );
                const jumpCount = document.createElement('td');
                row.appendChild(jumpCount);
                affectedSystemsBody.appendChild(row);
                sortSystems.push(async () => {
                    let [systemData, gates] = await Promise.all([
                        esiAPI.systemData(systemID),
                        esiAPI.systemGates(systemID)
                    ]);
                    return [systemID, { row, jumpCount, systemData, gates }];
                });
            });
            affectedSystems.appendChild(affectedSystemsBody);
            display.appendChild(affectedSystems);

            Promise.all(sortSystems.map(fn => fn())).then(systemArray => {
                let gates = systemArray.reduce(
                    (allGates, systemData) => ({
                        ...allGates,
                        ...systemData[1].gates
                    }),
                    {}
                );
                let systems = fromEntries(systemArray);
                let unvisitedSystems = [incursion.staging_solar_system_id];
                let visitedSystems = new Set();
                let jumps = 0;
                let furthest = incursion.staging_solar_system_id;
                let arrangeSystems: [number, number, HTMLElement][] = [];
                while (unvisitedSystems.length > 0) {
                    let newUnvisited: number[] = [];
                    unvisitedSystems.forEach(systemID => {
                        if (!visitedSystems.has(systemID)) {
                            visitedSystems.add(systemID);
                            if (jumps > 0) {
                                systems[systemID].jumpCount.appendChild(
                                    new Text(`${jumps}`)
                                );
                            }
                            newUnvisited = [
                                ...newUnvisited,
                                ...systems[systemID].systemData.stargates
                                    .map(
                                        (gateID: number) =>
                                            gates[gateID].destination.system_id
                                    )
                                    .filter((systemID: number) =>
                                        systems.hasOwnProperty(systemID)
                                    )
                            ];
                            furthest = systemID;
                            arrangeSystems.push([
                                jumps,
                                systemID,
                                systems[systemID].row
                            ]);
                        }
                    });
                    unvisitedSystems = newUnvisited;
                    jumps += 1;
                }
                arrangeSystems.sort((a, b) => a[0] - b[0]);
                let newBody = document.createElement('tbody');
                arrangeSystems.forEach(([, , element]) =>
                    newBody.appendChild(element)
                );
                affectedSystemsBody.replaceWith(newBody);
            });

            sortIncursions.push(async () => [
                display,
                await esiAPI.systemData(incursion.staging_solar_system_id)
            ]);

            incursions.appendChild(display);
        });
        document.body.appendChild(incursions);
        let incursionSecurities = await Promise.all(
            sortIncursions.map(fn => fn())
        );
        incursionSecurities.sort(
            (a, b) => b[1].security_status - a[1].security_status
        );
        const sortedIncursions = document.createElement('main');
        incursionSecurities.forEach(([element]) =>
            sortedIncursions.appendChild(element)
        );
        incursions.replaceWith(sortedIncursions);
    };
    openDatabase.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        let db = openDatabase.result;

        let constellationStore = db.createObjectStore('constellation', {
            keyPath: 'constellation_id'
        });
        constellationStore.createIndex('constellation_id', 'constellation_id', {
            unique: true
        });

        let regionStore = db.createObjectStore('region', {
            keyPath: 'region_id'
        });
        regionStore.createIndex('region_id', 'region_id', { unique: true });

        let systemStore = db.createObjectStore('system', {
            keyPath: 'system_id'
        });
        systemStore.createIndex('system_id', 'system_id', { unique: true });

        let asteroidBeltStore = db.createObjectStore('asteroid_belt', {
            keyPath: 'asteroidBeltID'
        });
        asteroidBeltStore.createIndex('asteroidBeltID', 'asteroidBeltID', {
            unique: true
        });

        let moonStore = db.createObjectStore('moon', { keyPath: 'moon_id' });
        moonStore.createIndex('moon_id', 'moon_id', { unique: true });

        let planetStore = db.createObjectStore('planet', {
            keyPath: 'planet_id'
        });
        planetStore.createIndex('planet_id', 'planet_id');

        let stargateStore = db.createObjectStore('stargate', {
            keyPath: 'stargate_id'
        });
        stargateStore.createIndex('stargate_id', 'stargate_id');

        let stationStore = db.createObjectStore('station', {
            keyPath: 'station_id'
        });
        stationStore.createIndex('station_id', 'station_id');
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
