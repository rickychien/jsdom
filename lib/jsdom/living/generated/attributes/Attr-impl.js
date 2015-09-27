"use strict";
const idlUtils = require("../util");
const changeAttribute = require("../../attributes").changeAttribute;

exports.implementation = class AttrImpl {
  constructor(_, privateData) {
    this.namespaceURI = privateData.namespace;
    this.prefix = privateData.namespacePrefix;
    this.localName = privateData.localName;
    this.name = privateData.name;
    this.ownerElement = privateData.element;
    this.specified = true;

    this._value = privateData.value;
  }

  get value() {
    return this._value;
  }
  set value(v) {
    if (this.element === null) {
      this._value = v;
    } else {
      changeAttribute(this.element, idlUtils.wrapperForImpl(this), v);
    }
  }

  // Delegate to value
  get nodeValue() {
    return this.value;
  }
  set nodeValue(v) {
    this.value = v;
  }

  // Delegate to value
  get textContent() {
    return this.value;
  }
  set textContent(v) {
    this.value = v;
  }
};
