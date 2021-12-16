const path = require('path');

const development = process.env.NODE_ENV != 'production';

const HTMLWebpackPlugin = require('html-webpack-plugin');

const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    entry: './src/incursion.ts',
    mode: development ? 'development' : 'production',
    module: {
        rules: [
            { test: /\.ts$/, use: 'babel-loader', exclude: /node_modules/ }
        ]
    },
    plugins: [
        new HTMLWebpackPlugin({ template: './src/incursions.html' }),
        new CopyPlugin({
            patterns: [{
                from: path.resolve(__dirname, 'src', 'images'),
                to: path.resolve(__dirname, 'dist')
            }]
        })
    ],
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        filename: 'incursion.js',
        path: path.resolve(__dirname, 'dist')
    },
    devServer: {
        port: 3000,
        host: '0.0.0.0',
        static: 'dist'
    }
};
