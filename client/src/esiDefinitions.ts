export interface Coordinate {
    x: number;
    y: number;
    z: number;
}

export interface Positioned {
    position: Coordinate;
}

export interface System extends Positioned {
    constellation_id: number;
    name: string;
    planets?: {
        asteroid_belts?: number[];
        moons?: number[];
        planet_id: number;
    }[];
    position: Coordinate;
    security_class?: number;
    security_status: number;
    star_id?: number;
    stargates?: number[];
    stations?: number[];
    station_id: number;
    radius?: number;
    displayRow?: HTMLElement;
    date?: Date;
}

export interface Incursion {
    constellation_id: number;
    faction_id: number;
    has_boss: number;
    infested_solar_systems: Array<number>;
    influence: number;
    staging_solar_system_id: number;
    state: string;
    type: string;
}

export interface Constellation extends Positioned {
    constellation_id: number;
    name: string;
    region_id: number;
    systems: Array<number>;
}

export interface Region {
    constellations: Array<number>;
    description: string;
    name: string;
    region_id: number;
    date?: Date;
}

export interface Stargate extends Positioned {
    destination: {
        stargate_id: number;
        system_id: number;
    };
    name: string;
    stargate_id: number;
    system_id: number;
    type_id: number;
}

export interface AsteroidBelt extends Positioned {
    name: string;
    system_id: number;
}

export interface Moon extends Positioned {
    moon_id: number;
    name: string;
    system_id: number;
}

export interface Planet extends Positioned {
    name: string;
    planet_id: number;
    system_id: number;
    type_id: number;
}

export interface Station extends Positioned {
    max_dockable_ship: number;
    name: string;
    office_rental_cost: number;
    owner?: number;
    race_id?: number;
    reprocessing_efficiency: number;
    reprocessing_stations_take: number;
    services: string[];
    station_id: number;
    system_id: number;
    type_id: number;
}

export interface Sovereignty {
    alliance_id?: number;
    corporation_id?: number;
    faction_id?: number;
    system_id: number;
}

export interface Alliance {
    name: string;
    ticker: string;
    alliance_id: number;
    expire?: Date;
}

export interface Faction {
    name: string;
    faction_id: number;
    expire?: Date;
}

export interface HistoryItem {
    state: 'string';
    constellation_id: number;
    has_boss: boolean;
    history: {
        [state: string]: string;
    };
}

export interface IncursionHistory {
    [constellation_id: number]: HistoryItem;
}

export interface TimerItem {
    constellation_id: number;
    time: string;
}

export interface TimerHistory {
    [security_status: string]: TimerItem[];
}
