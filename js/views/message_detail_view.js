/* vim: ts=4:sw=4:expandtab
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
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    var ContactView = Backbone.View.extend({
        className: 'contact-detail',
        initialize: function(options) {
            this.template = $('#contact-detail').html();
            Mustache.parse(this.template);
            this.conflict = options.conflict;
        },
        events: {
            'click .conflict': 'triggerConflict'
        },
        triggerConflict: function() {
            this.$el.trigger('conflict', {conflict: this.conflict});
        },
        render: function() {
            this.$el.html(Mustache.render(this.template, {
                name     : this.model.getTitle(),
                avatar   : this.model.get('avatar'),
                conflict : this.conflict
            }));
            return this;
        }
    });

    Whisper.MessageDetailView = Backbone.View.extend({
        className: 'message-detail',
        initialize: function(options) {
            this.template = $('#message-detail').html();
            Mustache.parse(this.template);
            this.view = new Whisper.MessageView({model: this.model});
            this.conversation = options.conversation;
        },
        events: {
            'click .back': 'goBack',
            'conflict': 'conflictDialogue'
        },
        goBack: function() {
            this.trigger('back');
        },
        verify: function(number) {
            var view = new Whisper.KeyVerificationView({
                model: {
                    their_key: textsecure.storage.devices.getIdentityKeyForNumber(number),
                    your_key: textsecure.storage.devices.getIdentityKeyForNumber(
                        textsecure.utils.unencodeNumber(textsecure.storage.getUnencrypted("number_id"))[0]
                    )
                }
            });
            this.$el.hide();
            view.render().$el.insertAfter(this.el);
            this.listenTo(view, 'back', function() {
                view.remove();
                this.$el.show();
            });
        },
        conflictDialogue: function(e, data) {
            var view = new Whisper.KeyConflictDialogueView({
                model: data.conflict,
                conversation: this.conversation
            });
            view.render().$el.appendTo(this.$el);
            this.listenTo(view, 'verify', function(data) {
                this.verify(data.number);
            });
            this.listenTo(view, 'resolve', function() {
                this.render();
            });
        },
        render: function() {
            this.$el.html(Mustache.render(this.template, {
                sent_at     : moment(this.model.get('sent_at')).toString(),
                received_at : moment(this.model.get('received_at')).toString(),
                tofrom      : this.model.isIncoming() ? 'From' : 'To',
            }));
            this.view.render().$el.prependTo(this.$el.find('.message-container'));

            this.conversation.contactCollection.each(function(contact) {
                var v = new ContactView({
                    model: contact,
                    conflict: this.model.getKeyConflict(contact.id)
                }).render().$el.appendTo(this.$el.find('.contacts'));
            }.bind(this));
        }
    });

})();
