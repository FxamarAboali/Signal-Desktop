/* vim: ts=4:sw=4
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

describe("Helpers", function() {
  describe("ArrayBuffer->String conversion", function() {
      it('works', function() {
          var b = new ArrayBuffer(3);
          var a = new Uint8Array(b);
          a[0] = 0;
          a[1] = 255;
          a[2] = 128;
          assert.equal(getString(b), "\x00\xff\x80");
      });
  });

  describe("toArrayBuffer", function() {
      it('returns undefined when passed undefined', function() {
          assert.strictEqual(toArrayBuffer(undefined), undefined);
      });
      it('returns ArrayBuffer when passed ArrayBuffer', function() {
          var StaticArrayBufferProto = new ArrayBuffer().__proto__;
          var anArrayBuffer = new ArrayBuffer();
          assert.strictEqual(toArrayBuffer(anArrayBuffer), anArrayBuffer);
      });
      it('throws an error when passed a non Stringable thing', function() {
          var madeUpObject = function() {};
          var notStringable = new madeUpObject();
          assert.throw(function() { toArrayBuffer(notStringable) },
                       Error, /Tried to convert a non-stringable thing/);
      });
  });

  describe("isEqual", function(){
      it('returns false when a or b is undefined', function(){
          assert.isFalse(isEqual("defined value", undefined, false));
          assert.isFalse(isEqual(undefined, "defined value", false));
      });
      it('returns true when a and b are equal', function(){
          var a = "same value";
          var b = "same value";
          assert.isTrue(isEqual(a, b, false));
      });
      it('returns false when a and b are not equal', function(){
          var a = "same value";
          var b = "diferent value";
          assert.isFalse(isEqual(a, b, false));
      });
      it('throws an error when a/b compare is too short', function(){
          var a = "1234";
          var b = "1234";
          assert.throw(function() { isEqual(a, b, true) },
                       Error, /a\/b compare too short/);
      });
  });
});
