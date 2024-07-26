import assert from 'assert';
import { _fetch } from './index.js';

const it = (description, fn) => {
    try {
        fn();
        console.log('\x1b[32m%s\x1b[0m', `\u2714 ${description}`);
    } catch (error) {
        console.log('\n');
        console.log('\x1b[31m%s\x1b[0m', `\u2718 ${description}`);
        console.error(error);
    }
};

it('should retrieve the _fetch function', () => {
    assert.equal(typeof _fetch, typeof (() => {}));
});