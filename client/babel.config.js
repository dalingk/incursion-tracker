module.exports = function(api) {
    api.cache(true);
    const presets = [
        '@babel/preset-typescript',
        [
            '@babel/preset-env',
            { modules: false, targets: { browsers: ['firefox >= 60', 'chrome >= 60'] } }
        ]
    ];
    const plugins = [];
    return {
        presets,
        plugins
    };
};
